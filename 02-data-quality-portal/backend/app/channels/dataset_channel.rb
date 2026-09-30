class DatasetChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_user
    stream_from "dataset_staff" if current_user.role == "staff"
  end
end
