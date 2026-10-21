require 'digest'

module Api
  class SessionsController < ApplicationController
    # Failed sign-ins are counted per client address, per address and email, and per email across
    # all addresses. Successful sign-ins are never counted, so normal use is not slowed while
    # password guessing is. The per-email count stops guessing spread over many addresses. A
    # browser that has signed in to the account before is exempt from it, so guessing cannot lock
    # the owner out of a browser they already use; the per-address counts still apply there.
    FAILED_SIGN_IN_WINDOW = 15.minutes
    FAILED_SIGN_INS_PER_ADDRESS = 20
    FAILED_SIGN_INS_PER_EMAIL = 5
    FAILED_SIGN_IN_ACCOUNT_WINDOW = 1.hour
    FAILED_SIGN_INS_PER_ACCOUNT = 30
    # A browser remembers the accounts it signed in to most recently, as email digests.
    KNOWN_ACCOUNTS_PER_BROWSER = 5
    KNOWN_ACCOUNTS_LIFETIME = 1.year

    def show
      response.headers['Cache-Control'] = 'no-store'
      render json: {user: current_user, csrf_token: form_authenticity_token}
    end

    def create
      email = params[:email].to_s.strip.downcase
      case sign_in_limit_reached(email)
      when :account
        return render json: {error: 'Too many failed sign-in attempts for this account. Wait an hour and try again, or sign in from a browser that has signed in to this account before.'}, status: :too_many_requests
      when Symbol
        return render json: {error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.'}, status: :too_many_requests
      end
      # authenticate_by takes the same time whether or not the email exists.
      user = User.authenticate_by(email: email, password: params[:password].to_s)
      if user
        Rails.cache.delete(failed_sign_in_counts(email)[:email].first)
        remember_account(email)
        current_login_session&.revoke!
        reset_session
        _record, token = LoginSession.issue!(user)
        session[:login_token] = token
        @current_login_session = nil
        render json: {user: user, csrf_token: form_authenticity_token}
      else
        failed_sign_in_counts(email).each_value { |key, _limit, window| Rails.cache.increment(key, 1, expires_in: window) }
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

    # Each count is [cache key, limit, window]. The per-account count is left out for a browser
    # that has signed in to the account before.
    def failed_sign_in_counts(email)
      address = "failed-sign-ins:#{request.remote_ip}"
      digest = Digest::SHA256.hexdigest(email)
      counts = {
        address: [address, FAILED_SIGN_INS_PER_ADDRESS, FAILED_SIGN_IN_WINDOW],
        email: ["#{address}:#{digest}", FAILED_SIGN_INS_PER_EMAIL, FAILED_SIGN_IN_WINDOW],
        account: ["failed-sign-ins:account:#{digest}", FAILED_SIGN_INS_PER_ACCOUNT, FAILED_SIGN_IN_ACCOUNT_WINDOW]
      }
      counts.delete(:account) if known_accounts.include?(digest)
      counts
    end

    def sign_in_limit_reached(email)
      failed_sign_in_counts(email).find { |_name, (key, limit, _window)| Rails.cache.read(key).to_i >= limit }&.first
    end

    # Each application's cookie has its own name because browsers share cookies across ports.
    def known_accounts_cookie
      Rails.application.config.session_options[:key].delete_suffix('_session') + '_known_accounts'
    end

    def known_accounts
      accounts = cookies.encrypted[known_accounts_cookie]
      accounts.is_a?(Array) ? accounts : []
    end

    def remember_account(email)
      digest = Digest::SHA256.hexdigest(email)
      cookies.encrypted[known_accounts_cookie] = {
        value: ([digest] + known_accounts).uniq.first(KNOWN_ACCOUNTS_PER_BROWSER),
        expires: KNOWN_ACCOUNTS_LIFETIME.from_now, httponly: true, same_site: :lax,
        secure: Rails.application.config.session_options[:secure]
      }
    end
  end
end
