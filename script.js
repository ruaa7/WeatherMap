'use strict';

const WEATHER_API_KEY = 'dbb6eb4991b6574e5dc1aed68cb83887';
const DEFAULT_VIEW = { lat: 15.5007, lon: 32.5599, zoom: 6 }; //Khartoum
const FAV_KEY = 'weathermap:favorites';
const searchForm =document.getElementById('search-form');
const input = document.getElementById('location-input');
const submitBtn = document.getElementById('submit-btn');
const loader = document.getElementById('loader');
const alertArea = document.getElementById('alert-area');
const favList = document.getElementById('favorites-list');
const mapShareBtn =document.getElementById('share-map-btn');
const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let currentMarker = null;
class AppError extends Error {}
// Show or hide the spinner
function setLoading(isLoading) {
  loader.hidden = !isLoading;
  submitBtn.disabled = isLoading;
}
// Remove any alert cards from the screen
function removeAlerts() {
  alertArea.replaceChildren();
}
//Show an alert card (error by default or success) in the alert area
function showAlert(message, type = 'error') {
  removeAlerts();
  const card = document.createElement('div');
  card.className = `alert-card alert-${type}`;
  card.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'alert-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '\u00D7';
  close.addEventListener('click', () => card.remove());
  card.append(text, close);
  alertArea.append(card);
  if (type === 'success') setTimeout(() => card.remove(), 5000);
}
//Convert the city name to coordinates using Nominatim
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new AppError('The geocoding servic is unavailable right now.');
  }
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new AppError(`Location "${query}" was not found check the spelling.`);
  }
  const { lat, lon, display_name: displayName } = results[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon), displayName };
}
//Fetch current weather from OpenWeatherMap
async function fetchWeather(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
  const res = await fetch(url);
  if (res.status === 404) throw new AppError('No weather data found for this location (404).');
  if (res.status === 401) throw new AppError('Invalid OpenWeatherMap API key.');
  if (res.status === 429) throw new AppError('Too many requests wait a minute and try again.');
  if (!res.ok) throw new AppError(`Weather service error (${res.status}). Please try again.`);
  return res.json();
}
//Weather popup content built with DOM methods
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
//Build the weather message text used for sharing
function getShareMessage(w, cityName) {
  const c = w.weather[0];
  return `Weather in ${cityName}: ${Math.round(w.main.temp)}°C, ${c.description}. ` + `Humidity ${w.main.humidity}%, wind ${w.wind.speed} m/s, clouds ${w.clouds.all}%.`;
}
//Share the weather text or copy it to the clipboard
async function shareWeather(text) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'WeatherMap', text });
    } else {
      await navigator.clipboard.writeText(text);
      showAlert('Copied to the clipboard.', 'success');
    }
  } catch (err) {
    if (err.name !== 'AbortError') showAlert('Couldnt share the weather message.');
  }
}
//Share a link to the current map view
function shareMap() {
  const c = map.getCenter();
  const z = map.getZoom();
  const link = `https://www.openstreetmap.org/#map=${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
  shareWeather(`Check out this map view (WeatherMap): ${link}`);
}
//Build the weather popup card
function buildPopup(w, cityName) {
  const c = w.weather[0];
  const card = makeEl('div', 'weather-card');
  card.append(makeEl('h3', '', `${cityName}${w.sys && w.sys.country ? ', ' + w.sys.country : ''}`));
  const main = makeEl('div', 'weather-main');
  const icon = document.createElement('img');
  icon.src = `https://openweathermap.org/img/wn/${c.icon}@2x.png`;
  icon.alt = c.description;
  main.append(icon, makeEl('span', 'weather-temp', `${Math.round(w.main.temp)}°C`));
  card.append(main, makeEl('p', 'weather-desc', c.description));
  const details = makeEl('ul', 'weather-details');
  [
    ['Clouds', `${w.clouds.all}%`],
    ['Humidity', `${w.main.humidity}%`],
    ['Wind', `${w.wind.speed} m/s`]
  ].forEach(([label, value]) => {
    const li = document.createElement('li');
    li.append(makeEl('span', '', label), makeEl('strong', '', value));
    details.append(li);
  });
  card.append(details);
  const actions = makeEl('div', 'card-actions');
  const shareBtn = makeEl('button', 'card-btn', 'Share');
  shareBtn.type = 'button';
  shareBtn.addEventListener('click', () => shareWeather(getShareMessage(w, cityName)));
  const favBtn = makeEl('button', 'card-btn', '\u2665 Favorite');
  favBtn.type = 'button';
  favBtn.addEventListener('click', () => addFavorite(cityName));
  actions.append(shareBtn, favBtn);
  card.append(actions);
  return card;
}
//Place the marker,center the map and open the weather popup
function showOnMap(lat, lon, w, cityName) {
  if (currentMarker) {
    map.removeLayer(currentMarker); //Remove the old marker
    currentMarker = null;
  }
  map.flyTo([lat, lon], 10, { duration: 1.5 });
  currentMarker = L.marker([lat, lon]).addTo(map);
  currentMarker.bindPopup(buildPopup(w, cityName), { minWidth: 210 }).openPopup();
}
// Main function
async function searchWeather(query) {
  const q = query.trim();
  if (!q) {
    showAlert('Please enter a location first.');
    return;
  }
  removeAlerts();
  setLoading(true);
  try {
    const place = await geocode(q);                     
    const weather = await fetchWeather(place.lat, place.lon); 
    const cityName = weather.name || place.displayName.split(',')[0];
    showOnMap(place.lat, place.lon, weather, cityName); 
  } catch (err) {
    if (err instanceof AppError) {
      showAlert(err.message);
    } else {
      console.error(err);
      showAlert('Network error.Check your internet connection and try again.');
    }
  } finally {
    setLoading(false);
  }
}
searchForm.addEventListener('submit', (event) => {
  event.preventDefault(); //no page reload
  searchWeather(input.value);
});
mapShareBtn.addEventListener('click', shareMap);

// Favorite cities: save, remove and show quick-access buttons 
function loadFavorites() {
  try {
    const data = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function saveFavorites(list) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    showAlert('Could not save favorites in this browser.');
  }
}
function addFavorite(name) {
  const list = loadFavorites();
  if (list.some((n) => n.toLowerCase() === name.toLowerCase())) {
    showAlert(`${name} is already in your favorites.`, 'success');
    return;
  }
  list.push(name);
  saveFavorites(list);
  renderFavorites();
  showAlert(`${name} added to favorites.`, 'success');
}
function removeFavorite(name) {
  saveFavorites(loadFavorites().filter((n) => n !== name));
  renderFavorites();
}
function renderFavorites() {
  const list = loadFavorites();
  favList.replaceChildren();
  if (list.length === 0) {
    favList.append(makeEl('span', 'favorites-empty', 'No favorites yet.'));
    return;
  }
  list.forEach((name) => {
    const chip = makeEl('div', 'fav-chip');
    const go = makeEl('button', '', name);
    go.type = 'button';
    go.addEventListener('click', () => {
      input.value = name;
      searchWeather(name);
    });
    const del = makeEl('button', 'fav-remove', '\u00D7');
    del.type = 'button';
    del.setAttribute('aria-label', `Remove ${name}`);
    del.addEventListener('click', () => removeFavorite(name));
    chip.append(go, del);
    favList.append(chip);
  });
}

renderFavorites();


