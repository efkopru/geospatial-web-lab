class ExportRun < ApplicationRecord
  belongs_to :requested_by, class_name: 'User'
  validates :status, inclusion: { in: %w[pending processing completed failed] }
  after_commit :broadcast_change

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
