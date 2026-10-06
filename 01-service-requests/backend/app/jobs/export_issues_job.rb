require 'csv'

class ExportIssuesJob < ApplicationJob
  queue_as :default
  retry_on StandardError, wait: :polynomially_longer, attempts: 3
  # After these attempts the run stays failed until someone generates a new report. Without
  # this, Sidekiq's own retries would quietly reprocess it for up to three weeks.
  sidekiq_options retry: false

  def perform(run_id)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      locked = connection.select_value("SELECT pg_try_advisory_lock(10102, #{Integer(run_id)})")
      return unless locked
      begin
        run = ExportRun.find(run_id)
        return if run.status == 'completed'
        run.update!(status: 'processing', failure: nil)
        count = 0
        content = CSV.generate do |csv|
          csv << %w[id title category status latitude longitude reporter assigned_to created_at resolved_at]
          Issue.visible_to(run.requested_by).includes(:reporter, :assigned_to).find_each do |issue|
            csv << [issue.id, safe_cell(issue.title), issue.category, issue.status, issue.latitude, issue.longitude,
                    safe_cell(issue.reporter.name), safe_cell(issue.assigned_to&.name), issue.created_at.iso8601, issue.resolved_at&.iso8601]
            count += 1
          end
        end
        run.update!(content: content, record_count: count, status: 'completed')
      rescue StandardError => error
        Rails.logger.error("Export #{run_id} failed: #{error.class}: #{error.message}")
        run&.update!(status: 'failed', failure: 'Report processing stopped unexpectedly. Generate a new report if automatic retries do not complete.')
        raise
      ensure
        connection.execute("SELECT pg_advisory_unlock(10102, #{Integer(run_id)})")
      end
    end
  end

  private

  def safe_cell(value)
    text = value.to_s
    text.match?(/\A[=+@\-\t\r\n]/) ? "'#{text}" : text
  end
end
