class InspectionChannel < ApplicationCable::Channel
  def subscribed
    stream_from "infrastructure_inspections"
  end
end
