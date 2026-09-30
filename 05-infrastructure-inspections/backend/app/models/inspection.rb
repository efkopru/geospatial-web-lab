class Inspection < ApplicationRecord
  belongs_to :infrastructure_asset
  belongs_to :author, class_name: "User"
  belongs_to :resolved_by, class_name: "User", optional: true
  has_many :inspection_events, dependent: :delete_all
  validates :severity, inclusion: { in: %w[low medium high critical] }
  validates :status, inclusion: { in: %w[open resolved] }
  validates :notes, length: { in: 10..2000 }
  validates :observed_at, presence: true
  validate :reasonable_observation_time
  validates :resolution_notes, length: { in: 10..2000 }, if: -> { status == "resolved" }
  after_create :record_creation

  def payload
    as_json(only: %i[id infrastructure_asset_id severity status notes resolution_notes observed_at resolved_at lock_version created_at]).merge(
      "author_name" => author.name, "resolved_by_name" => resolved_by&.name,
      "events" => inspection_events.order(:id).includes(:actor).map { |event| event.as_json(only: %i[id action notes created_at]).merge("actor_name" => event.actor.name) }
    )
  end

  private

  def reasonable_observation_time
    errors.add(:observed_at, "cannot be in the future") if observed_at && observed_at > 5.minutes.from_now
  end

  def record_creation
    inspection_events.create!(actor: author, action: "reported", notes: notes)
  end
end
