class InspectionEvent < ApplicationRecord
  belongs_to :inspection
  belongs_to :actor, class_name: "User"
  validates :action, inclusion: { in: %w[reported resolved reopened] }
  validates :notes, presence: true
end
