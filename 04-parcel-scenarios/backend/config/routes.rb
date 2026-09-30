Rails.application.routes.draw do
 get '/up', to: 'health#show'
 mount ActionCable.server => '/cable'
 namespace :api do
  resource :session, only: [:show, :create, :destroy]
  resources :parcels, only: [:index]
  resources :scenarios, only: [:index, :create, :show, :destroy] do
   post :recalculate, on: :member
   get :export, on: :member
  end
 end
end
