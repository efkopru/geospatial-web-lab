class ReplayControlJob < ApplicationJob
  queue_as :default
  self.enqueue_after_transaction_commit = false
  # Unlike the other apps' jobs, this one keeps Sidekiq's retries: a frame that failed was
  # rolled back, so retrying it resumes a running replay. Stale generations or cursors exit.

  def perform(generation, expected_cursor)
    ReplayEngine.advance!(generation, expected_cursor)
  end
end
