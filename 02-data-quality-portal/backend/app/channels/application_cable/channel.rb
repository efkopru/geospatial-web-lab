module ApplicationCable
  class Channel < ActionCable::Channel::Base
    periodically :verify_login_session, every: 15.seconds

    private

    def verify_login_session
      return if connection.session_current?
      stop_all_streams
      connection.close(reason: 'unauthorized', reconnect: false)
    end
  end
end
