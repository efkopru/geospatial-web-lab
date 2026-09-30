class CreateLoginSessions < ActiveRecord::Migration[8.1]
  def change
    create_table :login_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false
      t.datetime :expires_at, null: false
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :login_sessions, :token_digest, unique: true
    add_index :login_sessions, :expires_at
  end
end
