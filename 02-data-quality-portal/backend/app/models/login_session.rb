require 'digest'
class LoginSession < ApplicationRecord
  belongs_to :user
  scope :active, -> { where(revoked_at: nil).where('expires_at > ?', Time.current) }

  def self.issue!(user)
    token = SecureRandom.hex(32)
    record = create!(user: user, token_digest: Digest::SHA256.hexdigest(token), expires_at: 24.hours.from_now)
    [record, token]
  end

  def self.authenticate(token)
    return unless token.is_a?(String) && token.match?(/\A[0-9a-f]{64}\z/)
    active.includes(:user).find_by(token_digest: Digest::SHA256.hexdigest(token))
  end

  def revoke!
    update!(revoked_at: Time.current)
    begin
      ActionCable.server.remote_connections.where(current_user: user, login_session_id: id).disconnect(reconnect: false)
    rescue StandardError => e
    # Revocation is durable even when the immediate socket notification is unavailable.
      Rails.logger.warn("Session disconnect notification unavailable: #{e.class}")
    end
  end
end
