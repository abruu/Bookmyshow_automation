document.addEventListener("DOMContentLoaded", function () {
  // DOM elements
  const setupForm = document.getElementById("setupForm");
  const movieNameInput = document.getElementById("movieName");
  const formatPreferenceInput = document.getElementById("formatPreference");
  const refreshIntervalInput = document.getElementById("refreshInterval");
  const statusMessage = document.getElementById("statusMessage");
  const startMonitoringBtn = document.getElementById("startMonitoring");
  const stopMonitoringBtn = document.getElementById("stopMonitoring");

  // Hide unused form elements
  document.querySelector('label[for="movieDate"]').parentNode.style.display =
    "none";
  document.querySelector(
    'label[for="seatPreference"]'
  ).parentNode.style.display = "none";
  document.querySelector('label[for="autoBook"]').parentNode.style.display =
    "none";

  // Load saved preferences
  loadPreferences();

  // Event listeners
  setupForm.addEventListener("submit", savePreferences);
  startMonitoringBtn.addEventListener("click", startMonitoring);
  stopMonitoringBtn.addEventListener("click", stopMonitoring);

  // Load saved preferences from storage
  function loadPreferences() {
    chrome.storage.local.get(
      ["movieName", "formatPreference", "refreshInterval", "isMonitoring"],
      function (result) {
        if (result.movieName) movieNameInput.value = result.movieName;
        if (result.formatPreference)
          formatPreferenceInput.value = result.formatPreference;
        if (result.refreshInterval)
          refreshIntervalInput.value = result.refreshInterval;

        // Update UI based on monitoring status
        updateMonitoringStatus(result.isMonitoring);
      }
    );
  }

  // Save preferences to storage
  function savePreferences(e) {
    e.preventDefault();

    const preferences = {
      movieName: movieNameInput.value,
      formatPreference: formatPreferenceInput.value,
      refreshInterval: parseInt(refreshIntervalInput.value) || 1,
    };

    chrome.storage.local.set(preferences, function () {
      statusMessage.textContent = "Preferences saved successfully!";
      setTimeout(() => {
        chrome.storage.local.get(["isMonitoring"], function (result) {
          updateStatusMessage(
            result.isMonitoring,
            preferences.movieName,
            preferences.formatPreference
          );
        });
      }, 2000);
    });
  }

  // Update status message based on monitoring state
  function updateStatusMessage(isMonitoring, movieName, formatPreference) {
    if (isMonitoring) {
      const formatText =
        formatPreference === "ANY"
          ? "any format"
          : `${formatPreference} format`;
      statusMessage.textContent = `Monitoring: "${movieName}" with ${formatText}`;
    } else {
      statusMessage.textContent = "Not monitoring any movie";
    }
  }

  // Function to start monitoring
  function startMonitoring() {
    const movieNameInput = document.getElementById("movieName");
    const refreshIntervalInput = document.getElementById("refreshInterval");
    const formatPreferenceInput = document.getElementById("formatPreference");

    const movieName = movieNameInput.value.trim();
    let refreshInterval = parseFloat(refreshIntervalInput.value.trim());
    const formatPreference = formatPreferenceInput.value;

    // Validate inputs
    if (!movieName) {
      alert("Please enter a movie name to monitor");
      return;
    }

    if (isNaN(refreshInterval) || refreshInterval <= 0) {
      console.warn("Invalid refresh interval, using default of 3 minutes");
      refreshInterval = 3; // Default to 3 minutes
      refreshIntervalInput.value = "3";
    }

    // Log what we're sending
    console.log("Starting monitoring with:", {
      movieName: movieName,
      refreshInterval: refreshInterval,
      formatPreference: formatPreference,
    });

    // First, find all tabs that match BookMyShow URL
    chrome.tabs.query({ url: "https://in.bookmyshow.com/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        // Use first matching BookMyShow tab
        const targetTab = tabs[0];
        console.log("Found BookMyShow tab to monitor:", targetTab.id);

        // Send start monitoring message to background script with tab ID
        chrome.runtime.sendMessage(
          {
            action: "startMonitoringWithTab",
            data: {
              movieName: movieName,
              refreshInterval: refreshInterval,
              formatPreference: formatPreference,
              tabId: targetTab.id,
            },
          },
          (response) => {
            if (response && response.success) {
              isMonitoring = true;
              savePreferences();
              updateMonitoringStatus();
            } else {
              console.error("Failed to start monitoring");
            }
          }
        );
      } else {
        // No BookMyShow tab found, open one
        alert("Please open a BookMyShow tab first, then try again.");
      }
    });
  }

  // Stop monitoring
  function stopMonitoring() {
    chrome.runtime.sendMessage(
      { action: "stopMonitoring" },
      function (response) {
        if (response && response.success) {
          // Double-check after a brief delay that monitoring was actually stopped
          setTimeout(() => {
            chrome.storage.local.get(["isMonitoring"], function (result) {
              if (result.isMonitoring === true) {
                // If it's still showing as monitoring, force it to false
                chrome.storage.local.set({ isMonitoring: false }, function () {
                  console.log("Forced monitoring to stop via storage update");
                  updateMonitoringStatus(false);
                });
              } else {
                updateMonitoringStatus(false);
              }
            });
          }, 500);
        } else {
          // If response fails, force stop via storage
          chrome.storage.local.set({ isMonitoring: false }, function () {
            console.log("Forced monitoring to stop due to no response");
            updateMonitoringStatus(false);
          });
        }
      }
    );
  }

  // Update UI based on monitoring status
  function updateMonitoringStatus(isMonitoring) {
    if (isMonitoring) {
      chrome.storage.local.get(
        ["movieName", "formatPreference"],
        function (result) {
          updateStatusMessage(true, result.movieName, result.formatPreference);
          startMonitoringBtn.disabled = true;
          stopMonitoringBtn.disabled = false;
        }
      );
    } else {
      updateStatusMessage(false);
      startMonitoringBtn.disabled = false;
      stopMonitoringBtn.disabled = true;
    }
  }
});
