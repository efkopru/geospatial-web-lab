class Issue < ApplicationRecord
  CATEGORIES = %w[roads lighting drainage parks].freeze
  STATUSES = %w[new assigned in_progress resolved].freeze
  TRANSITIONS = {
    'new' => %w[assigned], 'assigned' => %w[in_progress],
    'in_progress' => %w[resolved assigned], 'resolved' => %w[in_progress]
  }.freeze
  self.ignored_columns = ['location']
  belongs_to :reporter, class_name: 'User'
  belongs_to :assigned_to, class_name: 'User', optional: true
  validates :title, presence: true, length: { maximum: 160 }
  validates :description, length: { maximum: 5000 }
  validates :category, inclusion: { in: CATEGORIES }
  validates :status, inclusion: { in: STATUSES }
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :assigned_to, presence: true, unless: -> { status == 'new' }
  validates :source_key, uniqueness: true, allow_nil: true
  validate :assignee_must_be_staff
  validate :valid_status_transition, on: :update
  before_validation { self.description = '' if description.nil? }
  before_save :track_resolution
  after_commit :broadcast_change

  scope :visible_to, ->(user) { user.role == 'staff' ? all : where(reporter_id: user.id) }
  scope :near, ->(latitude, longitude, meters) {
    where('ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?),4326)::geography, ?)', longitude, latitude, meters)
  }

  def as_payload
    {
      id: id, title: title, description: description, category: category, status: status,
      latitude: latitude.to_f, longitude: longitude.to_f, reporter: { id: reporter.id, name: reporter.name },
      assigned_to: assigned_to && { id: assigned_to.id, name: assigned_to.name },
      lock_version: lock_version, created_at: created_at, updated_at: updated_at, resolved_at: resolved_at
    }
  end

  private

  def assignee_must_be_staff
    errors.add(:assigned_to, 'must be a staff member') if assigned_to && assigned_to.role != 'staff'
  end

  def valid_status_transition
    return unless will_save_change_to_status?
    previous, following = status_change_to_be_saved
    errors.add(:status, "cannot move from #{previous} to #{following}") unless TRANSITIONS.fetch(previous, []).include?(following)
  end

  def track_resolution
    self.resolved_at = status == 'resolved' ? Time.current : nil if will_save_change_to_status?
  end

  def broadcast_change
    message = { type: 'issue_changed', id: id }
    ActionCable.server.broadcast('service_requests:staff', message)
    ActionCable.server.broadcast("service_requests:user:#{reporter_id}", message)
  rescue StandardError => error
    # The change is already committed. Polling recovers notifications missed
    # during a Redis outage; never report a successful write as failed.
    Rails.logger.warn("Issue #{id} notification unavailable: #{error.class}")
  end
end
