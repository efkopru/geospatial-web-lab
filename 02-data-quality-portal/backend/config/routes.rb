Rails.application.routes.draw do
  get "/up", to: "health#show"
  mount ActionCable.server => "/cable"
  namespace :api do
    resource :session, only: %i[show create destroy]
    resources :datasets, only: %i[index show create] do
      post :retry, on: :member
      post :approve, on: :member
      get :export, on: :member
    end
  end
end
