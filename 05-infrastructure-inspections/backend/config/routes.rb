Rails.application.routes.draw do
  get "/up", to: "health#show"
  mount ActionCable.server => "/cable"
  namespace :api do
    resource :session, only: %i[show create destroy]
    resources :assets, only: %i[index show] do
      resources :inspections, only: :create
    end
    resources :inspections, only: :update
    resources :profile_runs, only: %i[index create show] do
      post :retry, on: :member
      get :download, on: :member
    end
  end
end
