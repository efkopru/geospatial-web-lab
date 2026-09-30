class ScenarioChannel < ApplicationCable::Channel
 def subscribed
  stream_from "scenarios_#{current_user.id}"
 end
end
