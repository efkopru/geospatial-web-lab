module ApplicationCable
  class Channel < ActionCable::Channel::Base
    # A page opens one subscription, and every subscription runs its own session check. A
    # connection may hold only a few; further subscribe commands are rejected.
    MAX_SUBSCRIPTIONS_PER_CONNECTION = 5

    before_subscribe :limit_subscriptions
    periodically :verify_login_session, every: 15.seconds

    private

    def limit_subscriptions
      # The connection has already recorded this subscription when its callbacks run.
      return if connection.subscriptions.identifiers.size <= MAX_SUBSCRIPTIONS_PER_CONNECTION
      reject
      throw :abort
    end

    def verify_login_session
      return if connection.session_current?
      stop_all_streams
      connection.close(reason: 'unauthorized', reconnect: false)
    end
  end
end
