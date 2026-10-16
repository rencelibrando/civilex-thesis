import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

JOB_TTL_SECONDS = 300
MAX_RETAINED_JOBS = 300
PING_INTERVAL_SECONDS = 12.0


@dataclass
class StreamJob:
    job_id: str
    session_key: str
    user_id: str
    events: List[str] = field(default_factory=list)
    finished_at: Optional[float] = None
    task: Optional[asyncio.Task[Any]] = None
    _cond: asyncio.Condition = field(default_factory=asyncio.Condition)

    @property
    def finished(self) -> bool:
        return self.finished_at is not None

    async def publish(self, chunk: str) -> None:
        if chunk.startswith(":"):
            return
        async with self._cond:
            self.events.append(chunk)
            self._cond.notify_all()

    async def finish(self, status: str) -> None:
        await self.publish(f"data: {json.dumps({'type': 'end', 'status': status})}\n\n")
        async with self._cond:
            self.finished_at = time.monotonic()
            self._cond.notify_all()

    async def subscribe(self, after: int = -1) -> AsyncIterator[str]:
        cursor = max(after + 1, 0)
        while True:
            async with self._cond:
                if cursor >= len(self.events) and not self.finished:
                    try:
                        await asyncio.wait_for(self._cond.wait(), PING_INTERVAL_SECONDS)
                    except asyncio.TimeoutError:
                        pass
                batch, done = self.events[cursor:], self.finished
            if not batch and not done:
                yield ": ping\n\n"
                continue
            for seq, chunk in enumerate(batch, start=cursor):
                yield f"id: {seq}\n{chunk}"
            cursor += len(batch)
            if done and cursor >= len(self.events):
                return


class StreamJobRegistry:
    def __init__(self) -> None:
        self._jobs: Dict[str, StreamJob] = {}
        self._by_session: Dict[str, str] = {}

    def create(self, session_key: str, user_id: str) -> StreamJob:
        self._prune()
        job = StreamJob(job_id=uuid.uuid4().hex, session_key=session_key, user_id=user_id)
        self._jobs[job.job_id] = job
        self._by_session[session_key] = job.job_id
        return job

    def get(self, job_id: str, user_id: str = "") -> Optional[StreamJob]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job.user_id and user_id and job.user_id != user_id:
            return None
        if job.user_id and not user_id and job.user_id not in ("anon", "") and not job.user_id.startswith("anon_"):
            return None
        return job

    def active_for_session(self, session_key: str, user_id: Optional[str] = None) -> Optional[StreamJob]:
        job = self._jobs.get(self._by_session.get(session_key, ""))
        if not job or job.finished:
            return None
        if user_id is not None and user_id:
            if job.user_id and job.user_id not in ("anon", "") and job.user_id != user_id:
                return None
        return job

    def _prune(self) -> None:
        now = time.monotonic()
        finished = sorted(
            (j for j in self._jobs.values() if j.finished and j.finished_at is not None),
            key=lambda j: j.finished_at or 0.0,
        )
        overflow = max(len(finished) - MAX_RETAINED_JOBS, 0)
        for i, job in enumerate(finished):
            if job.finished_at is not None and (i < overflow or now - job.finished_at > JOB_TTL_SECONDS):
                self._jobs.pop(job.job_id, None)
                if self._by_session.get(job.session_key) == job.job_id:
                    self._by_session.pop(job.session_key, None)


stream_jobs = StreamJobRegistry()
