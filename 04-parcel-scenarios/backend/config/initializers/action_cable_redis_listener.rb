# Action Cable's Redis listener retries a lost connection `reconnect_attempts` times (by default
# once, immediately) and then ends its thread. Rails 8.1 never starts another listener, so every
# live update stops until the process restarts, and a Redis restart outlasts one retry. Each failed
# attempt also discards the confirmations owed to streams that started while Redis was away, and a
# browser that resends its subscription is ignored, so those streams stayed unconfirmed.
#
# Here the listener keeps retrying, after 0.5, 1 and 2 seconds and then every 5 seconds, until Redis
# is back or the server shuts down. It keeps the owed confirmations, and on reconnecting the adapter
# resubscribes every open stream and sends them. Rails main restarts a dead listener on the next new
# subscription instead (rails/rails@2a1ec91aa), which leaves streams that were already open
# unsubscribed, so this stays until Rails covers that case.
require "action_cable/subscription_adapter/redis"

module RedisListenerReconnection
  RETRY_DELAYS = [0.5, 1, 2].freeze
  LONGEST_RETRY_DELAY = 5

  def shutdown
    @shutting_down = true
    super
  end

  private
    def retry_connecting?
      return false if @shutting_down
      @reconnect_attempt += 1
      @adapter.logger.warn "Action Cable lost its Redis connection; retrying until Redis is back" if @reconnect_attempt == 1
      sleep RETRY_DELAYS.fetch(@reconnect_attempt - 1, LONGEST_RETRY_DELAY)
      true
    end

    def reset
      owed = @subscription_lock.synchronize { @subscribe_callbacks.transform_values(&:dup) }
      super
      @subscription_lock.synchronize { owed.each { |channel, callbacks| @subscribe_callbacks[channel].concat(callbacks) } }
    end

    # Runs once the new connection is subscribed, while the listener holds its subscription lock.
    # Confirmations are dropped for streams that closed while Redis was away.
    def resubscribe
      channels = @sync.synchronize { @subscribers.keys }
      @subscribe_callbacks.select! { |channel, _callbacks| channels.include?(channel) }
      super
      @adapter.logger.info "Action Cable reconnected to Redis and resubscribed #{channels.size} streams"
    end
end

listener = ActionCable::SubscriptionAdapter::Redis::Listener
unless listener.method_defined?(:shutdown) && %i[retry_connecting? reset resubscribe].all? { |name| listener.private_method_defined?(name) }
  raise "Action Cable's Redis listener changed; review config/initializers/action_cable_redis_listener.rb"
end
listener.prepend(RedisListenerReconnection)
