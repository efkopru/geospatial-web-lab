class ExportRun < ApplicationRecord
  belongs_to :requested_by, class_name: 'User'
  validates :status, inclusion: { in: %w[pending processing completed failed] }
  after_commit :broadcast_change
  # Each report stores its whole CSV, so only an account's newest reports are kept.
  KEEP_PER_USER = 30

  # Removes an account's finished reports beyond its newest KEEP_PER_USER. Reports still pending
  # or processing are never removed.
  def self.prune_for(user)
    newest = where(requested_by: user).order(id: :desc).limit(KEEP_PER_USER).select(:id)
    where(requested_by: user, status: %w[completed failed]).where.not(id: newest).delete_all
  end

  def as_payload
    { id: id, status: status, record_count: record_count, failure: failure, created_at: created_at }
  end

  private

  def broadcast_change
    ActionCable.server.broadcast('service_requests:staff', { type: 'export_changed', id: id })
  rescue StandardError => error
    Rails.logger.warn("Export #{id} notification unavailable: #{error.class}")
  end
end
