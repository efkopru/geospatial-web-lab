class ReplayChannel < ApplicationCable::Channel
  def subscribed
    stream_from "fleet_replay"
  end
end
