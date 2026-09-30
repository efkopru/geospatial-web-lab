class ImportRun < ApplicationRecord
  belongs_to :requested_by, class_name: 'User'
  validates :digest, uniqueness: { scope: :requested_by_id }
  validates :status, inclusion: { in: %w[pending processing completed failed] }
  after_commit :broadcast_change

  def as_payload
    { id: id, status: status, processed_count: processed_count, imported_count: imported_count,
      total_count: payload.fetch('features', []).size, errors: row_errors, failure: failure, created_at: created_at }
  end

  private

  def broadcast_change
    ActionCable.server.broadcast('service_requests:staff', { type: 'import_changed', id: id })
  rescue StandardError => error
    Rails.logger.warn("Import #{id} notification unavailable: #{error.class}")
  end
end
