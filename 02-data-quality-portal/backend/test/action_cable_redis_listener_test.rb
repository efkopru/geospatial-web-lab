require "test_helper"
require "securerandom"
require "timeout"

# A Redis restart closes Action Cable's subscription connection and refuses new connections for a
# moment. These tests use a real Redis: they close the listener's connection and refuse its
# reconnection attempts for a while, then check that streams recover without restarting the
# process (config/initializers/action_cable_redis_listener.rb).
class ActionCableRedisListenerTest < ActiveSupport::TestCase
  REDIS_URL = ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/0")

  setup do
    @name = "geolab-listener-test-#{SecureRandom.hex(4)}"
    config = ActionCable::Server::Configuration.new
    config.logger = ActiveSupport::Logger.new(nil)
    config.cable = {adapter: "redis", url: REDIS_URL, id: @name, channel_prefix: @name}
    @server = ActionCable::Server::Base.new(config: config)
    @redis_away = false
    @connector = ActionCable::SubscriptionAdapter::Redis.redis_connector
    connector, test = @connector, self
    # While Redis is "away", new connections go to a closed port and are refused.
    ActionCable::SubscriptionAdapter::Redis.redis_connector = ->(options) do
      test.redis_away? ? ::Redis.new(url: "redis://127.0.0.1:1") : connector.call(options)
    end
    @adapter = ActionCable::SubscriptionAdapter::Redis.new(@server)
    @adapter.broadcast("warm-up", "") # opens the broadcast connection while Redis is reachable
    @admin = ::Redis.new(url: REDIS_URL)
  end

  teardown do
    @redis_away = false
    @adapter.shutdown
    @server.event_loop.stop
    ActionCable::SubscriptionAdapter::Redis.redis_connector = @connector
    @admin.close
  end

  def redis_away? = @redis_away

  test "an open stream receives broadcasts again after Redis restarts" do
    received, confirmed = subscribe("updates")
    assert eventually { !confirmed.empty? }, "the stream was not confirmed"
    assert delivered?("updates", received)
    received.clear

    restart_redis(away_for: 1)
    assert delivered?("updates", received), "the stream received nothing after Redis came back"
  end

  test "a stream that starts while Redis is away is confirmed and receives broadcasts once it returns" do
    _received, confirmed = subscribe("updates")
    assert eventually { !confirmed.empty? }, "the first stream was not confirmed"

    restart_redis(away_for: 2) do
      @later, @later_confirmed = subscribe("later")
    end
    assert eventually { !@later_confirmed.empty? }, "the stream that started while Redis was away was never confirmed"
    assert delivered?("later", @later)
  end

  test "shutting down while Redis is away stops the reconnection attempts" do
    _received, confirmed = subscribe("updates")
    assert eventually { !confirmed.empty? }, "the stream was not confirmed"
    @redis_away = true
    drop_subscription_connection
    sleep 0.3
    assert Timeout.timeout(10) { @adapter.shutdown || true }
  end

  private

  def subscribe(channel)
    received, confirmed = Queue.new, Queue.new
    @adapter.subscribe(channel, ->(message) { received << message }, -> { confirmed << true })
    [received, confirmed]
  end

  # Closes the listener's connection and refuses reconnection for `away_for` seconds; the first
  # retry comes after 0.5 seconds, so at least one attempt is refused. Yields while Redis is away.
  def restart_redis(away_for:)
    @redis_away = true
    drop_subscription_connection
    sleep 0.3
    yield if block_given?
    sleep away_for - 0.3
    @redis_away = false
  end

  # Kills only this test's subscription connection, which Redis names after the adapter's id.
  def drop_subscription_connection
    ids = @admin.call("CLIENT", "LIST").lines.filter_map do |line|
      line[/\bid=(\d+)/, 1] if line.include?(" name=#{@name} ") && line[/\bsub=(\d+)/, 1].to_i.positive?
    end
    assert_equal 1, ids.size, "expected one subscription connection named #{@name}"
    @admin.call("CLIENT", "KILL", "ID", ids.first)
  end

  # Broadcasts until the stream receives one; broadcasts sent while unsubscribed are lost.
  def delivered?(channel, received)
    eventually do
      @adapter.broadcast(channel, "ping")
      sleep 0.2
      !received.empty?
    end
  end

  def eventually(seconds = 15)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
    until (result = yield)
      return false if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
      sleep 0.1
    end
    result
  end
end
