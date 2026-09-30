module Api
  class SessionsController < ApplicationController
    def show
      response.headers['Cache-Control'] = 'no-store'
      render json: {user: current_user, csrf_token: form_authenticity_token}
    end

    def create
      user = User.find_by(email: params[:email].to_s.strip.downcase)
      if user&.authenticate(params[:password].to_s)
        current_login_session&.revoke!
        reset_session
        _record, token = LoginSession.issue!(user)
        session[:login_token] = token
        @current_login_session = nil
        render json: {user: user, csrf_token: form_authenticity_token}
      else
        render json: {error: 'Incorrect email or password'}, status: :unauthorized
      end
    end

    def destroy
      current_login_session&.revoke!
      reset_session
      @current_login_session = nil
      render json: {user: nil, csrf_token: form_authenticity_token}
    end
  end
end
