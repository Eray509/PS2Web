import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import { installAudioUnlock } from './audioUnlock';
import App from './App';
import { Provider } from "react-redux";
import { store, init } from "./Actions";

// Muss vor dem Start des Emulators passieren, damit sein AudioContext erfasst wird.
installAudioUnlock();

store.dispatch(init());

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
  document.getElementById('root')
);
