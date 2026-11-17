module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user, :login_session_id

    # Clients send only short subscribe and unsubscribe commands. Action Cable writes a command it
    # cannot process to the log in full, so a longer message is neither decoded nor logged.
    MAX_MESSAGE_BYTES = 2_000

    def connect
      login = LoginSession.authenticate(request.session[:login_token])
      reject_unauthorized_connection unless login
      self.current_user = login.user
      self.login_session_id = login.id
    end

    def receive(websocket_message)
      return super if websocket_message.bytesize <= MAX_MESSAGE_BYTES
      logger.warn "Closing a connection that sent a #{websocket_message.bytesize}-byte message"
      close(reason: 'message_too_large', reconnect: false)
    end

    def session_current?
      login = LoginSession.active.includes(:user).find_by(id: login_session_id)
      login && login.user_id == current_user.id && login.user.role == current_user.role
    end
  end
end
