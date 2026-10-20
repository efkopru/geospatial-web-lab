class InspectionChannel < ApplicationCable::Channel
  def subscribed
    stream_from "infrastructure_inspections"
    stream_from "infrastructure_profiles_#{current_user.id}"
  end
end
