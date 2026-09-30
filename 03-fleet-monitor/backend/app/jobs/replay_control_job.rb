class ReplayControlJob < ApplicationJob
  queue_as :default
  self.enqueue_after_transaction_commit = false

  def perform(generation, expected_cursor)
    ReplayEngine.advance!(generation, expected_cursor)
  end
end
