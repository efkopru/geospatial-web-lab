require 'test_helper'

class AuthenticationTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(email: 'auth-audit@example.test', name: 'Audit user', password: 'Learning123!', role: 'staff')
  end

  # Sign-in sets the session cookie and the remembered-accounts cookie; this returns the session one.
  def session_cookie(response)
    name = Rails.application.config.session_options[:key]
    Array(response.headers['Set-Cookie']).flat_map { |header| header.split("\n") }.find { |cookie| cookie.start_with?("#{name}=") }.split(';').first
  end

  # Records the failures a guessing attack spread over many addresses leaves on an email.
  def reach_account_limit(email)
    Rails.cache.write("failed-sign-ins:account:#{Digest::SHA256.hexdigest(email)}", Api::SessionsController::FAILED_SIGN_INS_PER_ACCOUNT, expires_in: 1.hour)
  end

  test 'a copied cookie cannot authenticate after the original session logs out' do
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
    copied_cookie = session_cookie(response)
    delete '/api/session', as: :json
    assert_response :success
    replay = ActionDispatch::Integration::Session.new(Rails.application)
    replay.get '/api/session', headers: {'HTTP_COOKIE' => copied_cookie}
    assert_nil replay.response.parsed_body['user'], 'Logout must revoke the server session, including copied cookies'
  end

  test 'logout revokes only the current login and tolerates notification failure' do
    other = ActionDispatch::Integration::Session.new(Rails.application)
    other.post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    original = ActionCable.server.method(:remote_connections)
    begin
      ActionCable.server.define_singleton_method(:remote_connections) { raise IOError, 'Notification connection lost' }
      delete '/api/session', as: :json
      assert_response :success
    ensure
      ActionCable.server.define_singleton_method(:remote_connections, original)
    end
    get '/api/session'
    assert_nil response.parsed_body['user']
    other.get '/api/session'
    assert_equal @user.id, other.response.parsed_body.dig('user', 'id')
    assert_equal 1, LoginSession.active.where(user: @user).count
  end

  test 'expired sessions cannot authenticate through HTTP or the live connection' do
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    record = LoginSession.find_by!(user: @user)
    connection = ApplicationCable::Connection.new(ActionCable.server, {})
    connection.current_user = @user
    connection.login_session_id = record.id
    assert connection.session_current?
    record.update!(expires_at: 1.minute.ago)
    assert_not connection.session_current?
    get '/api/session'
    assert_nil response.parsed_body['user']
  end

  test 'signing in again revokes the prior cookie and stores only the token digest' do
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    cookie = session_cookie(response)
    old = LoginSession.find_by!(user: @user)
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert old.reload.revoked_at
    assert_equal 1, LoginSession.active.where(user: @user).count
    replay = ActionDispatch::Integration::Session.new(Rails.application)
    replay.get '/api/session', headers: {'HTTP_COOKIE' => cookie}
    assert_nil replay.response.parsed_body['user']
    record, token = LoginSession.issue!(@user)
    assert_equal Digest::SHA256.hexdigest(token), record.token_digest
    assert_not_equal token, record.token_digest
  end

  test 'repeated failed sign-ins for an email are throttled; successful sign-ins are not counted' do
    6.times do
      post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
      assert_response :success
    end
    5.times do |attempt|
      # Email case and surrounding spaces do not start a separate count.
      post '/api/session', params: {email: attempt.even? ? @user.email : " #{@user.email.upcase} ", password: 'wrong password'}, as: :json
      assert_response :unauthorized
    end
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :too_many_requests
    assert_match 'Too many failed sign-in attempts', response.parsed_body['error']
    other = User.create!(email: 'auth-other@example.test', name: 'Other user', password: 'Learning123!', role: 'reporter')
    post '/api/session', params: {email: other.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'failed sign-ins from one address are throttled across emails' do
    20.times do |attempt|
      post '/api/session', params: {email: "guess-#{attempt}@example.test", password: 'wrong password'}, as: :json
      assert_response :unauthorized
    end
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :too_many_requests
  end

  test 'failed sign-ins for one email are limited across addresses, except in browsers that signed in before' do
    known = open_session
    known.post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json, env: {'REMOTE_ADDR' => '198.51.100.1'}
    known.assert_response :success
    cookies_set = Array(known.response.headers['Set-Cookie']).join("\n")
    assert_includes cookies_set, Rails.application.config.session_options[:key].delete_suffix('_session') + '_known_accounts='
    assert_not_includes cookies_set, Digest::SHA256.hexdigest(@user.email), 'The remembered accounts are encrypted'
    Api::SessionsController::FAILED_SIGN_INS_PER_ACCOUNT.times do |attempt|
      post '/api/session', params: {email: @user.email, password: 'wrong password'}, as: :json, env: {'REMOTE_ADDR' => "203.0.113.#{attempt + 1}"}
      assert_response :unauthorized
    end
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json, env: {'REMOTE_ADDR' => '192.0.2.1'}
    assert_response :too_many_requests
    assert_match 'Too many failed sign-in attempts for this account', response.parsed_body['error']
    # A browser that signed in before can still sign in, and its failures are not counted for the account.
    known.post '/api/session', params: {email: @user.email, password: 'wrong password'}, as: :json, env: {'REMOTE_ADDR' => '192.0.2.2'}
    known.assert_response :unauthorized
    known.post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json, env: {'REMOTE_ADDR' => '192.0.2.2'}
    known.assert_response :success
    other = User.create!(email: 'auth-other@example.test', name: 'Other user', password: 'Learning123!', role: 'reporter')
    post '/api/session', params: {email: other.email, password: 'Learning123!'}, as: :json, env: {'REMOTE_ADDR' => '192.0.2.1'}
    assert_response :success
    travel Api::SessionsController::FAILED_SIGN_IN_ACCOUNT_WINDOW + 1.minute
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json, env: {'REMOTE_ADDR' => '192.0.2.1'}
    assert_response :success
  end

  test 'a browser is exempt from the account limit only for the five accounts it signed in to most recently' do
    users = 6.times.map { |index| User.create!(email: "known-#{index}@example.test", name: "Known #{index}", password: 'Learning123!', role: 'reporter') }
    users.each do |user|
      post '/api/session', params: {email: user.email, password: 'Learning123!'}, as: :json
      assert_response :success
    end
    users.first(2).each { |user| reach_account_limit(user.email) }
    post '/api/session', params: {email: users.first.email, password: 'Learning123!'}, as: :json
    assert_response :too_many_requests
    post '/api/session', params: {email: users.second.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'a successful sign-in clears the failed attempts for that email' do
    4.times { post '/api/session', params: {email: @user.email, password: 'wrong password'}, as: :json }
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
    4.times do
      post '/api/session', params: {email: @user.email, password: 'wrong password'}, as: :json
      assert_response :unauthorized
    end
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'unknown emails and blank passwords are rejected like wrong passwords' do
    post '/api/session', params: {email: 'nobody@example.test', password: 'Learning123!'}, as: :json
    assert_response :unauthorized
    assert_equal 'Incorrect email or password', response.parsed_body['error']
    post '/api/session', params: {email: @user.email, password: ''}, as: :json
    assert_response :unauthorized
    assert_equal 'Incorrect email or password', response.parsed_body['error']
  end

  test 'signing in removes expired login sessions and keeps revoked ones until expiry' do
    expired, = LoginSession.issue!(@user)
    expired.update!(expires_at: 1.minute.ago)
    revoked, = LoginSession.issue!(@user)
    revoked.update!(revoked_at: Time.current)
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
    assert_not LoginSession.exists?(expired.id)
    assert LoginSession.exists?(revoked.id)
  end

  test 'live connection becomes invalid after an account role change' do
    record, = LoginSession.issue!(@user)
    connection = ApplicationCable::Connection.new(ActionCable.server, {})
    connection.current_user = @user
    connection.login_session_id = record.id
    assert connection.session_current?
    User.where(id: @user.id).update_all(role: 'reporter')
    assert_not connection.session_current?
  end
end
