class DatasetVersion < ApplicationRecord
  belongs_to :dataset
  belongs_to :approved_by, class_name: "User"
  def readonly?
    persisted?
  end
end
