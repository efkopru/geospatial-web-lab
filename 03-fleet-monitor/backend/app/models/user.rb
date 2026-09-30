class User < ApplicationRecord
 has_many :login_sessions, dependent: :delete_all
 has_secure_password
 validates :email, presence: true, uniqueness: {case_sensitive: false}
 validates :name, presence: true
 validates :role, inclusion: {in: %w[reporter staff]}
 before_validation { self.email = email.to_s.strip.downcase }
 def staff? = role == "staff"
 def as_json(*) = {id: id, name: name, email: email, role: role}
end
