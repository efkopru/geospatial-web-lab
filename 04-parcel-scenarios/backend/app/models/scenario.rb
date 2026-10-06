class Scenario < ApplicationRecord
 belongs_to :user
 validates :name, presence: true, length: {maximum: 100}
 validates :floors, numericality: {only_integer: true, greater_than: 0, less_than_or_equal_to: 30}
 validates :coverage, numericality: {greater_than_or_equal_to: 0.05, less_than_or_equal_to: 0.8}
 validates :unit_area, numericality: {only_integer: true, greater_than_or_equal_to: 400, less_than_or_equal_to: 3000}
 validates :status, inclusion: {in: %w[queued processing complete failed]}
 validate :known_parcels
 LIST_LIMIT=100
 # The list omits each result's parcel snapshot (every selected boundary); show and export keep it.
 scope :listed, -> { select(*(column_names-['results']),Arel.sql("results - 'parcel_snapshot' AS results")).order(created_at: :desc,id: :desc).limit(LIST_LIMIT) }
 def known_parcels
  unless parcel_ids.is_a?(Array) && parcel_ids.any? && parcel_ids.length <= 50 && parcel_ids.all? { |id| id.is_a?(Integer) } && parcel_ids.uniq.length == parcel_ids.length && Parcel.where(id: parcel_ids).count == parcel_ids.length
   errors.add(:parcel_ids, 'must contain 1 to 50 distinct existing parcel IDs')
  end
 end
 def broadcast
  ActionCable.server.broadcast("scenarios_#{user_id}", {type: 'scenario_changed', id: id})
 rescue StandardError => e
  Rails.logger.warn("Scenario notification unavailable: #{e.class}")
 end
end
