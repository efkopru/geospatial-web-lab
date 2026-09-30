class RequestUpdatesChannel < ApplicationCable::Channel
  def subscribed
    reject unless current_user
    return unless current_user
    stream_from(current_user.role == 'staff' ? 'service_requests:staff' : "service_requests:user:#{current_user.id}")
  end
end
