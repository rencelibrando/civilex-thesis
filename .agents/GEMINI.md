# Antigravity Autonomous Verification Protocol

## Definition of "Done"
Do NOT state that work is complete, resolved, or ready until all verification checks pass with zero warnings and zero errors.

## Mandatory Verification Loop
After implementing any feature or modification:
1. Static Type Checking & Linting:
   - Run `npm run type-check` (or `tsc --noEmit`) in `/frontend` and `/backend-node`.
   - Run `mypy .` or `ruff check .` in `/service-rag-python`.
2. Endpoint & Route Verification:
   - Test all new/modified HTTP and RPC endpoints using curl, test runners, or integration scripts.
   - Verify that routes return expected status codes (e.g., 200/201) and valid payload schemas.
3. Self-Correction Loop:
   - If any command fails or prints errors/tracebacks to stdout/stderr:
     1. Analyze the stack trace.
     2. Edit the problematic files.
     3. Re-run the verification command.
   - Repeat this loop autonomously until all tests output exit code 0.