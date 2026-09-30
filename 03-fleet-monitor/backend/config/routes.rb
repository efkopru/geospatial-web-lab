Rails.application.routes.draw do
  get "/up", to: "health#show"
  mount ActionCable.server => "/cable"
  namespace :api do
    resource :session, only: %i[show create destroy]
    get "fleet", to: "fleet#show"
    post "fleet/control", to: "fleet#control"
    get "vehicles/:id/history", to: "vehicles#history"
    post "vehicles/:id/telemetry", to: "vehicles#telemetry"
    resources :geofences, only: %i[create destroy]
  end
end
