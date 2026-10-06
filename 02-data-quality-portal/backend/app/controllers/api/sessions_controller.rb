require 'digest'

module Api
  class SessionsController < ApplicationController
    # Failed sign-ins are counted per client address and per address and email. Successful
    # sign-ins are never counted, so normal use is not slowed while password guessing is.
    FAILED_SIGN_IN_WINDOW = 15.minutes
    FAILED_SIGN_INS_PER_ADDRESS = 20
    FAILED_SIGN_INS_PER_EMAIL = 5

    def show
      response.headers['Cache-Control'] = 'no-store'
      render json: {user: current_user, csrf_token: form_authenticity_token}
    end

    def create
      email = params[:email].to_s.strip.downcase
      if sign_in_blocked?(email)
        return render json: {error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.'}, status: :too_many_requests
      end
      # authenticate_by takes the same time whether or not the email exists.
      user = User.authenticate_by(email: email, password: params[:password].to_s)
      if user
        Rails.cache.delete(failed_sign_in_keys(email)[:email])
        current_login_session&.revoke!
        reset_session
        _record, token = LoginSession.issue!(user)
        session[:login_token] = token
        @current_login_session = nil
        render json: {user: user, csrf_token: form_authenticity_token}
      else
        failed_sign_in_keys(email).each_value { |key| Rails.cache.increment(key, 1, expires_in: FAILED_SIGN_IN_WINDOW) }
        render json: {error: 'Incorrect email or password'}, status: :unauthorized
      end
    end

    def destroy
      current_login_session&.revoke!
      reset_session
      @current_login_session = nil
      render json: {user: nil, csrf_token: form_authenticity_token}
    end

    private

    def failed_sign_in_keys(email)
      address = "failed-sign-ins:#{request.remote_ip}"
      {address: address, email: "#{address}:#{Digest::SHA256.hexdigest(email)}"}
    end

    def sign_in_blocked?(email)
      keys = failed_sign_in_keys(email)
      Rails.cache.read(keys[:address]).to_i >= FAILED_SIGN_INS_PER_ADDRESS ||
        Rails.cache.read(keys[:email]).to_i >= FAILED_SIGN_INS_PER_EMAIL
    end
  end
end
