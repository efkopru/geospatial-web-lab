module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user, :login_session_id

    def connect
      login = LoginSession.authenticate(request.session[:login_token])
      reject_unauthorized_connection unless login
      self.current_user = login.user
      self.login_session_id = login.id
    end

    def session_current?
      login = LoginSession.active.includes(:user).find_by(id: login_session_id)
      login && login.user_id == current_user.id && login.user.role == current_user.role
    end
  end
end
