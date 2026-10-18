class ImportRun < ApplicationRecord
  belongs_to :requested_by, class_name: 'User'
  validates :digest, uniqueness: { scope: :requested_by_id }
  validates :status, inclusion: { in: %w[pending processing completed failed] }
  after_commit :broadcast_change
  # First key of the session advisory lock ImportIssuesJob holds while it runs; the run id is the second.
  ADVISORY_LOCK_KEY = 10101

  # A run is abandoned when it is still marked processing but no worker holds its lock, for example
  # after a worker process was killed: PostgreSQL releases a session lock when its connection ends.
  # pg_locks is read rather than the lock taken, so this check never blocks a worker that is starting.
  def abandoned?
    status == 'processing' && !self.class.connection.select_value(self.class.sanitize_sql_array([<<~SQL, ADVISORY_LOCK_KEY, id]))
      SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = ? AND objid = ? AND objsubid = 2)
    SQL
  end

  def as_payload
    { id: id, status: status, processed_count: processed_count, imported_count: imported_count,
      total_count: payload.fetch('features', []).size, errors: row_errors, failure: failure, abandoned: abandoned?, created_at: created_at }
  end

  private

  def broadcast_change
    ActionCable.server.broadcast('service_requests:staff', { type: 'import_changed', id: id })
  rescue StandardError => error
    Rails.logger.warn("Import #{id} notification unavailable: #{error.class}")
  end
end
