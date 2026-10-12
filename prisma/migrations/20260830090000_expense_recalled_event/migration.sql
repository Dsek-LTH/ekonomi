-- The submitter taking their own utlägg back out of the attest queue.
--
-- Its own event rather than reusing CHANGES_REQUESTED: that one says an
-- attester asked for something, and a timeline that says so when nobody did is
-- a timeline that misremembers who acted. The whole point of the event log on
-- an utlägg is that it can be read a year later and be true.
ALTER TYPE "ExpenseEventType" ADD VALUE 'RECALLED';
