require 'test_helper'
require 'stringio'

# Limits that keep one client from filling the logs or multiplying live-update work, and the
# refusal of text the database cannot store. The code under test is identical in all five backends.
class RequestHardeningTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(email: 'hardening@example.test', name: 'Hardening user', password: 'Learning123!', role: 'staff')
  end

  # Returns what the block's requests write to the log at the production log level.
  def logged
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output)
    logger.level = :info
    previous = [Rails.logger, ActionController::Base.logger]
    Rails.logger = ActionController::Base.logger = logger
    yield
    output.string
  ensure
    Rails.logger, ActionController::Base.logger = previous
  end

  # A live-update connection for @user that records what it would send instead of using a socket.
  def live_connection
    record, = LoginSession.issue!(@user)
    connection = ApplicationCable::Connection.new(ActionCable.server, {})
    connection.current_user = @user
    connection.login_session_id = record.id
    sent = []
    connection.define_singleton_method(:transmit) { |message| sent << message }
    [connection, sent]
  end

  test 'a request with a large body is logged as its size, without its content' do
    log = logged do
      post '/api/session', params: {email: 'nobody@example.test', password: 'wrong password', padding: 'x' * 200_000}, as: :json
    end
    assert_response :unauthorized
    assert_match(/"request body" => "\[2\d{5} bytes not logged\]"/, log)
    assert_not_includes log, 'xxxxxxxx'
    assert_operator log.bytesize, :<, 2_000
  end

  test 'a small request is logged once, without its password or uploaded content' do
    log = logged do
      post '/api/session?page=7', as: :json,
        params: {email: 'nobody@example.test', password: 'wrong password', source: '{"type":"FeatureCollection"}', geojson: {type: 'FeatureCollection'}}
    end
    assert_response :unauthorized
    assert_equal 1, log.scan('nobody@example.test').size, 'Parameters are not nested a second time under the controller name'
    assert_includes log, '"page" => "7"'
    assert_not_includes log, 'wrong password'
    assert_not_includes log, 'FeatureCollection'
  end

  test 'a parameter that contains the NUL character is refused before it reaches the database' do
    {
      {email: "nul\u0000@example.test", password: 'x'} => 'The parameter email',
      {email: 'a@example.test', password: 'x', filter: {tags: ['fine', "bad\u0000"]}} => 'The parameter filter.tags[1]',
      {email: 'a@example.test', password: 'x', filter: {"key\u0000" => 'value'}} => 'A parameter name in filter'
    }.each do |parameters, location|
      post '/api/session', params: parameters, as: :json
      assert_response :unprocessable_entity
      assert_equal "#{location} contains the NUL character (\\u0000), which cannot be stored. Remove it and try again.", response.parsed_body['error']
    end
    get '/api/session?q=a%00b'
    assert_response :unprocessable_entity
    assert_match 'The parameter q contains the NUL character', response.parsed_body['error']
    assert_nil Rails.cache.read('sign-ins:127.0.0.1'), 'A refused request is not counted as a sign-in attempt'
  end

  test 'a live-update connection holds a few subscriptions and rejects the rest' do
    channel = Rails.root.glob('app/channels/*_channel.rb').map { |file| file.basename('.rb').to_s.camelize.constantize }.first
    limit = ApplicationCable::Channel::MAX_SUBSCRIPTIONS_PER_CONNECTION
    connection, sent = live_connection
    (limit + 3).times { |number| connection.subscriptions.add('identifier' => {channel: channel.name, number: number}.to_json) }
    assert_equal limit, connection.subscriptions.identifiers.size
    assert_equal 3, sent.count { |message| message[:type] == 'reject_subscription' }
    # A rejected subscription leaves room again once another one ends.
    connection.subscriptions.remove('identifier' => {channel: channel.name, number: 0}.to_json)
    connection.subscriptions.add('identifier' => {channel: channel.name, number: 99}.to_json)
    assert_equal limit, connection.subscriptions.identifiers.size
    assert_includes connection.subscriptions.identifiers, {channel: channel.name, number: 99}.to_json
  ensure
    connection&.subscriptions&.unsubscribe_from_all
  end

  test 'a live-update connection that sends a long message is closed without processing it' do
    connection, = live_connection
    closed = []
    connection.define_singleton_method(:close) { |**options| closed << options }
    channel = Rails.root.glob('app/channels/*_channel.rb').map { |file| file.basename('.rb').to_s.camelize.constantize }.first
    connection.receive({command: 'subscribe', identifier: {channel: channel.name, padding: 'x' * 5_000}.to_json}.to_json)
    assert_equal [{reason: 'message_too_large', reconnect: false}], closed
    assert_empty connection.subscriptions.identifiers
  end
end
