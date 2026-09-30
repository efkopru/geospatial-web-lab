class DatasetRecord < ApplicationRecord
  self.ignored_columns += ["geom"]
  belongs_to :dataset
  validates :ordinal, uniqueness: { scope: :dataset_id }
end
