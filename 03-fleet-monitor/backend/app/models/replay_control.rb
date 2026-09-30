class ReplayControl < ApplicationRecord
  validates :speed, inclusion: { in: [1, 2, 4] }

  def self.instance
    create_or_find_by!(id: 1)
  end

  def payload
    as_json(only: %i[running generation cursor sequence speed]).merge("simulation" => true)
  end
end
