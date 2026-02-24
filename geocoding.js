// FRONTEND FIX: Replace the geocoding function in your RequesterView.html or main.js

async function locateHospital() {
    const hospitalName = document.getElementById('hospitalName').value.trim();
    const district = document.getElementById('district').value.trim();
    const city = document.getElementById('city').value.trim();
    
    if (!hospitalName) {
        alert('Please enter a hospital name');
        return;
    }
    
    const locateBtn = document.querySelector('.locate-btn');
    const originalText = locateBtn.innerHTML;
    locateBtn.innerHTML = '🔍 Locating Hospital...';
    locateBtn.disabled = true;
    
    try {
        const response = await fetch('http://localhost:8000/geocode/hospital', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                hospitalName: hospitalName,
                district: district || null,
                city: city || null
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Geocoding failed');
        }
        
        if (data.success && data.location) {
            // Update the map with hospital location
            const { latitude, longitude, display_name } = data.location;
            
            // Store coordinates
            window.hospitalCoordinates = { latitude, longitude };
            
            // Update map if it exists
            if (window.map) {
                window.map.setView([latitude, longitude], 15);
                
                // Remove existing hospital marker if any
                if (window.hospitalMarker) {
                    window.map.removeLayer(window.hospitalMarker);
                }
                
                // Add new hospital marker
                window.hospitalMarker = L.marker([latitude, longitude], {
                    icon: L.icon({
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                }).addTo(window.map);
                
                window.hospitalMarker.bindPopup(`<b>${hospitalName}</b><br>${display_name}`).openPopup();
            }
            
            // Show success message
            alert(`✅ Hospital located: ${display_name}`);
            
            // Show alternatives if available
            if (data.alternatives && data.alternatives.length > 0) {
                console.log('Alternative locations:', data.alternatives);
            }
        } else {
            throw new Error('Invalid response from geocoding service');
        }
        
    } catch (error) {
        console.error('Geocoding error:', error);
        
        // User-friendly error messages
        let errorMessage = 'Unable to locate hospital. ';
        
        if (error.message.includes('not found')) {
            errorMessage += 'Please check the hospital name spelling.';
        } else if (error.message.includes('unavailable') || error.message.includes('timed out')) {
            errorMessage += 'Service temporarily unavailable. Please try again in a moment.';
        } else if (error.message.includes('internet') || error.message.includes('network')) {
            errorMessage += 'Please check your internet connection.';
        } else {
            errorMessage += error.message || 'Please try again.';
        }
        
        alert(errorMessage);
        
        // Optionally: Allow manual coordinate entry
        const useManual = confirm('Would you like to select the location manually on the map?');
        if (useManual && window.map) {
            alert('Click on the map to select the hospital location');
            enableManualLocationSelection();
        }
    } finally {
        locateBtn.innerHTML = originalText;
        locateBtn.disabled = false;
    }
}

// Optional: Manual location selection
function enableManualLocationSelection() {
    if (!window.map) return;
    
    // Remove existing click handler
    window.map.off('click');
    
    // Add new click handler
    window.map.on('click', function(e) {
        const { lat, lng } = e.latlng;
        
        // Remove existing hospital marker
        if (window.hospitalMarker) {
            window.map.removeLayer(window.hospitalMarker);
        }
        
        // Add new marker
        window.hospitalMarker = L.marker([lat, lng], {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            })
        }).addTo(window.map);
        
        const hospitalName = document.getElementById('hospitalName').value || 'Selected Location';
        window.hospitalMarker.bindPopup(`<b>${hospitalName}</b><br>Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`).openPopup();
        
        // Store coordinates
        window.hospitalCoordinates = { latitude: lat, longitude: lng };
        
        // Disable click handler after selection
        window.map.off('click');
        
        alert('✅ Location selected on map');
    });
}

// Make sure to call this function when the "Locate Hospital" button is clicked
// Example: 
// <button onclick="locateHospital()" class="locate-btn">🔍 Locate Hospital</button>