class CalculateScenarioJob < ApplicationJob
 # A failed scenario is retried from the app, which advances its revision. Sidekiq's own
 # retries would only find it failed and log the same error again for weeks.
 sidekiq_options retry: false
 def perform(id, revision)
  scenario = Scenario.find_by(id: id)
  return unless scenario
  begin
   scenario.with_lock do
    return unless scenario.revision == revision && scenario.status == 'queued'
    scenario.update!(status: 'processing', error_message: nil)
    scenario.update!(results: ScenarioCalculator.call(scenario), status: 'complete')
   end
  rescue StandardError => e
   Rails.logger.error("Scenario #{id} calculation failed: #{e.class}: #{e.message}")
   # The failed transaction has released its lock. A retry may have advanced
   # the revision already, so persist failure only for this unfinished revision.
   changed = Scenario.where(id: id, revision: revision, status: %w[queued processing]).update_all(
    status: 'failed', error_message: 'Calculation stopped unexpectedly. Retry this scenario.', updated_at: Time.current)
   scenario.reload.broadcast if changed.positive?
   raise
  end
  # Notification transport is outside calculation failure handling: the result
  # is committed and must remain complete even if delivery is unavailable.
  scenario.broadcast
 end
end
