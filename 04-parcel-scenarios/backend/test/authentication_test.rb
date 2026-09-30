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
