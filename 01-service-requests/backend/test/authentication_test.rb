require 'test_helper'

class AuthenticationTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(email: 'auth-audit@example.test', name: 'Audit user', password: 'Learning123!', role: 'staff')
  end

  test 'a copied cookie cannot authenticate after the original session logs out' do
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
    copied_cookie = response.headers['Set-Cookie'].split(';').first
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
    cookie = response.headers['Set-Cookie'].split(';').first
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
