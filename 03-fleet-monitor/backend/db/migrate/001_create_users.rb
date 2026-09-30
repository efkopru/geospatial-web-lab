class CreateUsers < ActiveRecord::Migration[8.1]
 def change
  enable_extension "postgis"
  create_table :users do |t|
   t.string :email, null: false
   t.string :name, null: false
   t.string :password_digest, null: false
   t.string :role, null: false, default: "reporter"
   t.timestamps
  end
  add_index :users, :email, unique: true
 end
end
