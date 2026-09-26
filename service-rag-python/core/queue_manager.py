import asyncio
import time
import logging
from typing import Dict, List, Optional, Tuple
from core.config import MAX_CONCURRENT_QUERIES, MAX_QUEUE_SIZE, QUEUE_TIMEOUT_SECONDS

logger = logging.getLogger("civilex.queue")

class QueryQueueManager:
    """
    Unified In-Memory Concurrency Limiter & FIFO Resource Queue.
    
    Protects the underlying LLM (LM Studio Gemma 4 on a 6GB VRAM GPU)
    from multiple simultaneous queries that would trigger severe CUDA OOM crashes,
    PCIe memory thrashing, or extreme latency degradation.
    """

    def __init__(
        self,
        max_concurrent: int = MAX_CONCURRENT_QUERIES,
        max_queue_size: int = MAX_QUEUE_SIZE,
        queue_timeout: float = QUEUE_TIMEOUT_SECONDS
    ):
        self.max_concurrent = max_concurrent
        self.max_queue_size = max_queue_size
        self.queue_timeout = queue_timeout

        self._lock = asyncio.Lock()
        self._ticket_counter = 0

        # Waiters waiting in FIFO order: list of dicts
        self._waiters: List[Dict] = []
        
        # Currently active execution slots: ticket -> info dict
        self._active_slots: Dict[int, Dict] = {}

        # Global statistics
        self._started_at = time.time()
        self.total_served = 0
        self.total_queued = 0
        self.total_timeouts = 0
        self.total_rejections = 0
        self._recent_latencies: List[float] = []

    @property
    def active_queries(self) -> int:
        return len(self._active_slots)

    @property
    def queued_queries(self) -> int:
        return len(self._waiters)

    async def enter_queue(self, user_id: str = "anon", session_id: str = "") -> Tuple[bool, int, str]:
        """
        Request entry into the query processing pipeline.
        
        Returns:
            (acquired_immediately: bool, ticket_id: int, error_code: str)
            - If acquired_immediately is True: The caller can proceed directly without waiting.
            - If acquired_immediately is False and error_code == "": Caller is registered in queue.
            - If error_code != "": Caller was rejected (e.g. "QUEUE_FULL").
        """
        async with self._lock:
            self._ticket_counter += 1
            ticket = self._ticket_counter

            # Check if queue has exceeded maximum allowed capacity
            if len(self._waiters) >= self.max_queue_size:
                self.total_rejections += 1
                logger.warning(f"Queue rejected ticket {ticket}: Queue full ({len(self._waiters)}/{self.max_queue_size})")
                return False, -1, "QUEUE_FULL"

            # Check if execution slot is immediately available
            if len(self._active_slots) < self.max_concurrent:
                self._active_slots[ticket] = {
                    "ticket": ticket,
                    "user_id": user_id,
                    "session_id": session_id,
                    "started_at": time.time(),
                }
                logger.info(f"[Queue] Ticket #{ticket} immediately granted slot ({len(self._active_slots)}/{self.max_concurrent} active).")
                return True, ticket, ""

            # Concurrency limit reached -> Enqueue request in FIFO order
            event = asyncio.Event()
            waiter_info = {
                "ticket": ticket,
                "user_id": user_id,
                "session_id": session_id,
                "event": event,
                "entered_at": time.time(),
            }
            self._waiters.append(waiter_info)
            self.total_queued += 1
            pos = len(self._waiters)
            logger.info(f"[Queue] Ticket #{ticket} enqueued at position #{pos} (Active: {len(self._active_slots)}/{self.max_concurrent}).")
            return False, ticket, ""

    async def get_queue_position(self, ticket: int) -> int:
        """Returns the current 1-based position in queue, or 0 if active/not in queue."""
        async with self._lock:
            for idx, w in enumerate(self._waiters):
                if w["ticket"] == ticket:
                    return idx + 1
            return 0

    async def cancel_waiter(self, ticket: int):
        """Remove a waiting ticket if the client disconnects or cancels prematurely."""
        async with self._lock:
            initial_count = len(self._waiters)
            self._waiters = [w for w in self._waiters if w["ticket"] != ticket]
            if len(self._waiters) < initial_count:
                logger.info(f"[Queue] Ticket #{ticket} cancelled while in queue.")

    async def release_slot(self, ticket: int):
        """
        Release an active execution slot.
        Automatically grants the freed slot to the next waiter in FIFO line.
        """
        async with self._lock:
            if ticket in self._active_slots:
                slot_info = self._active_slots.pop(ticket)
                duration = time.time() - slot_info.get("started_at", time.time())
                self.total_served += 1
                self._recent_latencies.append(duration)
                if len(self._recent_latencies) > 50:
                    self._recent_latencies.pop(0)
                logger.info(f"[Queue] Ticket #{ticket} completed in {duration:.2f}s. Active: {len(self._active_slots)}/{self.max_concurrent}.")

            # If there are pending waiters and free capacity, wake up the next waiter
            while self._waiters and len(self._active_slots) < self.max_concurrent:
                next_waiter = self._waiters.pop(0)
                next_ticket = next_waiter["ticket"]
                self._active_slots[next_ticket] = {
                    "ticket": next_ticket,
                    "user_id": next_waiter["user_id"],
                    "session_id": next_waiter["session_id"],
                    "started_at": time.time(),
                }
                # Signal the waiting coroutine that its turn has arrived
                next_waiter["event"].set()
                logger.info(f"[Queue] Ticket #{next_ticket} promoted from queue to active slot ({len(self._active_slots)}/{self.max_concurrent} active).")

    def get_status(self) -> Dict:
        """Returns a snapshot of the current queue and concurrency metrics."""
        now = time.time()
        active_list = []
        for ticket, slot in self._active_slots.items():
            active_list.append({
                "ticket": ticket,
                "user_id": slot.get("user_id"),
                "session_id": slot.get("session_id"),
                "running_time_sec": round(now - slot.get("started_at", now), 1)
            })

        waiters_list = []
        for idx, w in enumerate(self._waiters):
            waiters_list.append({
                "position": idx + 1,
                "ticket": w["ticket"],
                "user_id": w.get("user_id"),
                "session_id": w.get("session_id"),
                "wait_time_sec": round(now - w.get("entered_at", now), 1)
            })

        avg_latency = (
            round(sum(self._recent_latencies) / len(self._recent_latencies), 2)
            if self._recent_latencies
            else 0.0
        )

        return {
            "max_concurrent": self.max_concurrent,
            "max_queue_size": self.max_queue_size,
            "queue_timeout_sec": self.queue_timeout,
            "active_queries": len(self._active_slots),
            "queued_queries": len(self._waiters),
            "total_served": self.total_served,
            "total_queued": self.total_queued,
            "total_timeouts": self.total_timeouts,
            "total_rejections": self.total_rejections,
            "avg_latency_sec": avg_latency,
            "active_slots": active_list,
            "waiters": waiters_list,
            "uptime_sec": round(now - self._started_at, 1),
        }

# Global singleton instance initialized from unified configuration
queue_manager = QueryQueueManager()
