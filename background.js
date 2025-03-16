// Initialize variables
let isMonitoring = false;
let targetTab = null;
let bookMyShowUrl = "https://in.bookmyshow.com";
let backupIntervalId = null; // Track the backup interval

// When extension is loaded, start the monitoring
chrome.runtime.onInstalled.addListener(() => {
  // Get the saved preferences or use defaults
  chrome.storage.local.get(
    {
      movieName: "", // No default movie
      formatPreference: "ANY", // Default format preference
      isMonitoring: false, // Default monitoring status
    },
    (result) => {
      if (result.isMonitoring && result.movieName && result.refreshInterval) {
        startMonitoring(
          result.movieName,
          result.formatPreference,
          result.refreshInterval
        );
      }
    }
  );
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startMonitoring") {
    startMonitoring(
      request.data.movieName,
      request.data.formatPreference,
      request.data.refreshInterval
    );
    sendResponse({ success: true });
  } else if (request.action === "startMonitoringWithTab") {
    // Use the specified tab ID from the popup
    startMonitoringWithTab(
      request.data.movieName,
      request.data.formatPreference,
      request.data.refreshInterval,
      request.data.tabId
    );
    sendResponse({ success: true });
  } else if (request.action === "stopMonitoring") {
    stopMonitoring();
    sendResponse({ success: true });
  } else if (request.action === "getStatus") {
    sendResponse({
      isMonitoring: isMonitoring,
      movieName: request.data ? request.data.movieName : null,
      formatPreference: request.data ? request.data.formatPreference : null,
      targetTabId: targetTab ? targetTab.id : null,
    });
  } else if (request.action === "movieFound") {
    console.log("Movie found:", request.data);

    // Focus the tab and window where the movie was found
    try {
      chrome.windows.update(sender.tab.windowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error focusing window:",
            chrome.runtime.lastError.message
          );
          return;
        }

        chrome.tabs.update(sender.tab.id, { active: true }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error focusing tab:",
              chrome.runtime.lastError.message
            );
            return;
          }

          // Play notification sound and show notification after focusing
          playNotificationSound();
          showNotification(request.data.movieName, request.data.formatInfo);
        });
      });
    } catch (error) {
      console.error("Error when focusing tab/window:", error);
      // Still try to show notification even if focusing fails
      playNotificationSound();
      showNotification(request.data.movieName, request.data.formatInfo);
    }
  } else if (request.action === "forceTabFocus") {
    console.log("Force focusing tab because movie was found:", request.data);

    // Store the tab information to ensure we can focus it again if needed
    targetTab = sender.tab;

    // Create a more persistent focus approach - try multiple times
    const focusAttempts = 5; // Try 5 times
    let attemptCount = 0;

    function attemptFocus() {
      console.log(
        `Focus attempt ${attemptCount + 1}/${focusAttempts} for tab:`,
        targetTab.id
      );

      // Always force the window and tab to the front when a movie is found
      try {
        // First check if the tab still exists
        chrome.tabs.get(targetTab.id, (tab) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Tab no longer exists:",
              chrome.runtime.lastError.message
            );
            return; // Skip this attempt if tab doesn't exist
          }

          chrome.windows.update(targetTab.windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error focusing window:",
                chrome.runtime.lastError.message
              );
              // Still try to focus the tab even if window focus fails
            }

            chrome.tabs.update(targetTab.id, { active: true }, () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Error focusing tab:",
                  chrome.runtime.lastError.message
                );
              } else {
                console.log(
                  `Tab and window focus attempt ${attemptCount + 1} completed`
                );
              }
            });
          });
        });
      } catch (error) {
        console.error("Error in focus attempt:", error);
      }

      attemptCount++;
      if (attemptCount < focusAttempts) {
        // Try again after a short delay
        setTimeout(attemptFocus, 1000);
      }
    }

    // Start the focus attempts
    attemptFocus();

    // Play notification sound to alert the user - use the function
    playNotificationSound();

    // Show a notification with both "View Now" and "Stop Monitoring" buttons
    chrome.notifications.create({
      type: "basic",
      iconUrl: "images/icon128.png",
      title: "BookMyShow Movie Alert! 🎬",
      message: `Found "${request.data.movieName}" with ${
        request.data.formatInfo
          ? request.data.formatInfo
          : "the selected format"
      }!`,
      priority: 2,
      buttons: [{ title: "View Now" }, { title: "Stop Monitoring" }],
    });
  } else if (request.action === "focusTab") {
    // Focus the window first, then the tab
    try {
      chrome.windows.update(sender.tab.windowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error focusing window:",
            chrome.runtime.lastError.message
          );
          return;
        }

        chrome.tabs.update(sender.tab.id, { active: true }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error focusing tab:",
              chrome.runtime.lastError.message
            );
          }
        });
      });
    } catch (error) {
      console.error("Error focusing tab/window in focusTab action:", error);
    }
  }
  return true; // Keep the message channel open for async responses
});

// Function to start monitoring
function startMonitoring(movieName, formatPreference, interval) {
  if (!movieName) {
    console.error("No movie name provided for monitoring");
    return;
  }

  if (!interval) {
    console.error("No refresh interval provided");
    return;
  }

  // Ensure interval is a valid number
  const intervalMinutes = parseFloat(interval);
  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    console.error("Invalid refresh interval:", interval);
    return;
  }

  console.log("Starting monitoring with interval:", intervalMinutes, "minutes");
  isMonitoring = true;

  // Save status to storage
  chrome.storage.local.set({
    movieName: movieName,
    formatPreference: formatPreference || "ANY",
    refreshInterval: intervalMinutes,
    isMonitoring: true,
    lastChecked: new Date().toISOString(),
  });

  console.log(
    "Starting to monitor for:",
    movieName,
    "with format:",
    formatPreference,
    "refresh interval:",
    intervalMinutes,
    "minutes"
  );

  // Get the current active tab and use it for monitoring
  getCurrentTab().then((tab) => {
    targetTab = tab;
    console.log("Using current tab for monitoring:", tab.id, tab.url);

    // Set up alarm for periodic checking with the specified interval
    setRefreshAlarm(intervalMinutes);

    // Inject content script into the current tab if needed
    injectContentScriptIfNeeded(tab);
  });
}

// Function to get the current active tab
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// Function to inject content script into a tab if needed
function injectContentScriptIfNeeded(tab) {
  try {
    if (!tab || !tab.id) {
      console.error(
        "Invalid tab provided to injectContentScriptIfNeeded:",
        tab
      );
      return;
    }

    // Send a test message to see if content script is already running
    chrome.tabs.sendMessage(tab.id, { action: "ping" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(
          "Content script not detected, injecting:",
          chrome.runtime.lastError.message
        );

        // Content script is not running, inject it
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            files: ["content.js"],
          },
          (results) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error injecting content script:",
                chrome.runtime.lastError.message
              );
              return;
            }

            console.log("Content script injected into tab:", tab.id);
            // Notify content script to start monitoring
            setTimeout(() => {
              chrome.tabs.sendMessage(
                tab.id,
                { action: "checkMonitoring" },
                (resp) => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "Error sending checkMonitoring after injection:",
                      chrome.runtime.lastError.message
                    );
                  } else {
                    console.log("checkMonitoring message sent successfully");
                  }
                }
              );
            }, 500);
          }
        );
      } else {
        // Content script is already running, just send monitoring info
        console.log("Content script already running, sending checkMonitoring");
        chrome.tabs.sendMessage(
          tab.id,
          { action: "checkMonitoring" },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error sending checkMonitoring to existing script:",
                chrome.runtime.lastError.message
              );
            }
          }
        );
      }
    });
  } catch (error) {
    console.error("Error checking or injecting content script:", error);
  }
}

// Function to open BookMyShow tab - now mostly for fallback
async function openBookMyShowTab(movieName) {
  // Now this function is only used as a fallback
  try {
    // If we already have a target tab, try to use it
    if (targetTab) {
      try {
        await chrome.tabs.get(targetTab.id);
        // Don't focus the tab, just make sure it exists
        return;
      } catch (e) {
        // Tab doesn't exist anymore, continue to create new tab
        console.log("Target tab no longer exists, creating new one");
      }
    }

    // Create new tab - but don't make it active
    const tab = await chrome.tabs.create({
      url: bookMyShowUrl,
      active: false, // Open in background
    });

    // Store the tab reference
    targetTab = tab;

    console.log("Opened new BookMyShow tab:", tab.id);
  } catch (error) {
    console.error("Error opening BookMyShow tab:", error);
  }
}

// Function to stop monitoring
function stopMonitoring() {
  console.log("Stopping monitoring");
  isMonitoring = false;

  // Clear the refresh alarm
  chrome.alarms.clear("refreshBookMyShow", () => {
    console.log("Alarm cleared");
  });

  // Clear the backup interval
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log("Backup interval cleared");
  }

  // Save status to storage
  chrome.storage.local.set({ isMonitoring: false }, () => {
    console.log("Updated storage: isMonitoring=false");
  });

  console.log("Stopped monitoring");

  // Notify the content script to stop monitoring
  if (targetTab) {
    try {
      chrome.tabs.sendMessage(
        targetTab.id,
        { action: "stopMonitoring" },
        (response) => {
          console.log("Content script notified to stop monitoring", response);
        }
      );
    } catch (error) {
      console.error("Error notifying content script:", error);
    }
  }
}

// Function to refresh the BookMyShow page
async function refreshBookMyShowPage() {
  if (!isMonitoring || !targetTab) {
    console.log(
      "Not refreshing: monitoring=",
      isMonitoring,
      "targetTab=",
      !!targetTab
    );
    return;
  }

  try {
    // Check if tab still exists
    let tab = null;
    try {
      tab = await chrome.tabs.get(targetTab.id);
    } catch (e) {
      console.log("Error checking tab existence:", e);
      tab = null;
    }

    if (!tab) {
      console.log("Target tab no longer exists");

      // Tab was closed, stop monitoring or use current active tab
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs && tabs.length > 0) {
          // Use the current active tab
          targetTab = tabs[0];
          console.log("Switched to new active tab:", targetTab.id);

          // Check if it's a valid BookMyShow tab
          if (targetTab.url && targetTab.url.includes("bookmyshow.com")) {
            console.log("New tab is a valid BookMyShow tab");
            injectContentScriptIfNeeded(targetTab);
          } else {
            console.log("New tab is not a BookMyShow tab, stopping monitoring");
            stopMonitoring();
          }
        } else {
          console.log("No active tab found, stopping monitoring");
          stopMonitoring();
        }
      } catch (e) {
        console.error("Error finding new tab:", e);
        stopMonitoring();
      }
      return;
    }

    console.log("⚠️ REFRESHING PAGE at:", new Date().toLocaleTimeString());

    // Don't focus the tab during regular refresh
    // Just reload it in the background
    try {
      await chrome.tabs.reload(tab.id, { bypassCache: true });

      // Update last checked time
      chrome.storage.local.set({
        lastChecked: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Error reloading tab:", e);
      // If we couldn't reload, maybe the tab was closed just now
      return;
    }

    // Give the page time to load after refresh, then make sure content script is running
    // and check for movie
    setTimeout(() => {
      if (isMonitoring) {
        console.log("Re-checking content script after page refresh");

        // Check if the tab still exists
        chrome.tabs.get(tab.id, (currentTab) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Tab no longer exists after refresh:",
              chrome.runtime.lastError.message
            );
            return;
          }

          // First ensure the content script is running
          try {
            chrome.tabs.sendMessage(tab.id, { action: "ping" }, (response) => {
              if (chrome.runtime.lastError) {
                console.log(
                  "Content script not responding after refresh, re-injecting"
                );
                chrome.scripting.executeScript(
                  {
                    target: { tabId: tab.id },
                    files: ["content.js"],
                  },
                  (results) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "Error injecting content script after refresh:",
                        chrome.runtime.lastError.message
                      );
                      return;
                    }

                    console.log("Content script re-injected after refresh");
                    // Get movie name and format from storage again to ensure consistency
                    chrome.storage.local.get(
                      ["movieName", "formatPreference", "refreshInterval"],
                      (result) => {
                        if (result.movieName) {
                          // Wait a moment for script to initialize
                          setTimeout(() => {
                            chrome.tabs.sendMessage(
                              tab.id,
                              {
                                action: "checkMovie",
                                forceCheck: true,
                              },
                              (resp) => {
                                if (chrome.runtime.lastError) {
                                  console.error(
                                    "Error sending checkMovie after injection:",
                                    chrome.runtime.lastError.message
                                  );
                                }
                              }
                            );
                          }, 1000);
                        }
                      }
                    );
                  }
                );
              } else {
                console.log(
                  "Content script responded after refresh, telling it to check for movie"
                );
                // Content script is active, tell it to check for movie now
                chrome.tabs.sendMessage(
                  tab.id,
                  {
                    action: "checkMovie",
                    forceCheck: true,
                  },
                  (resp) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "Error sending checkMovie to existing script:",
                        chrome.runtime.lastError.message
                      );
                    }
                  }
                );
              }
            });
          } catch (error) {
            console.error(
              "Error checking content script after refresh:",
              error
            );
            injectContentScriptIfNeeded(tab);
          }
        });
      }
    }, 3000);

    console.log(
      "Refreshed BookMyShow page at",
      new Date().toLocaleTimeString()
    );
  } catch (error) {
    console.error("Error refreshing BookMyShow page:", error);

    // If there's an error and monitoring should continue, try to find a new tab
    if (isMonitoring) {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs && tabs.length > 0) {
          targetTab = tabs[0];
          console.log(
            "Error recovery: switched to new active tab:",
            targetTab.id
          );
        } else {
          console.log("No active tab found after error, stopping monitoring");
          stopMonitoring();
        }
      } catch (e) {
        console.error("Error during recovery:", e);
        stopMonitoring();
      }
    }
  }
}

// Set up alarm for periodic page refresh
function setRefreshAlarm(interval) {
  // Parse interval to ensure it's a number
  const intervalMinutes = parseFloat(interval);

  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    console.error("Invalid refresh interval:", interval);
    return;
  }

  console.log("Setting up refresh with interval:", intervalMinutes, "minutes");

  // Clear any existing alarm
  chrome.alarms.clear("refreshBookMyShow");

  // Clear any existing backup interval
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log("Cleared existing backup interval");
  }

  // Calculate milliseconds for the interval
  const intervalMs = intervalMinutes * 60 * 1000; // Convert minutes to milliseconds

  // Set up a direct timeout for the first refresh
  setTimeout(() => {
    if (isMonitoring) {
      console.log("First timed refresh at:", new Date().toLocaleTimeString());
      refreshBookMyShowPage();

      // After the first refresh, set up repeating interval
      backupIntervalId = setInterval(() => {
        if (isMonitoring) {
          console.log("Interval refresh at:", new Date().toLocaleTimeString());
          refreshBookMyShowPage();
        } else {
          // If no longer monitoring, clear the interval
          if (backupIntervalId) {
            clearInterval(backupIntervalId);
            backupIntervalId = null;
          }
        }
      }, intervalMs);
    }
  }, intervalMs);

  console.log(
    "Direct refresh scheduled for",
    intervalMs,
    "milliseconds from now"
  );

  // Immediate first check without refresh - don't refresh, just check the page
  setTimeout(() => {
    if (isMonitoring && targetTab) {
      console.log("Performing initial check without refreshing");
      // Send message to content script to check the page without refreshing
      chrome.tabs
        .sendMessage(targetTab.id, {
          action: "checkMonitoring",
          initialCheck: true,
        })
        .catch((err) =>
          console.log("Error sending initial check message:", err)
        );
    }
  }, 2000);
}

// Listen for alarm to trigger page refresh
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshBookMyShow" && isMonitoring) {
    console.log("Alarm triggered refresh at:", new Date().toLocaleTimeString());
    refreshBookMyShowPage();
  }
});

// Function to notify user when movie is found
function notifyMovieFound(data) {
  // Create notification
  chrome.notifications.create({
    type: "basic",
    iconUrl: "images/icon128.png",
    title: "BookMyShow Movie Alert! 🎬",
    message: `Found "${data.movieName}" with ${
      data.formatInfo ? data.formatInfo : "the selected format"
    }!`,
    priority: 2,
    buttons: [{ title: "View Now" }],
  });

  // Try to play notification sound
  try {
    const audio = new Audio("notification.mp3");
    audio.play().catch((err) => {
      console.log("Could not play notification sound:", err);
    });
  } catch (error) {
    console.log("Error with notification sound:", error);
  }

  // Focus the BookMyShow tab
  if (targetTab) {
    chrome.tabs.update(targetTab.id, { active: true });
    chrome.windows.update(targetTab.windowId, { focused: true });
  }
}

// Listen for notification button clicks
chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    if (buttonIndex === 0 && targetTab) {
      // Focus the tab using the persistent approach
      console.log("Notification button clicked, focusing tab:", targetTab.id);

      // First check if the tab still exists
      chrome.tabs.get(targetTab.id, (tab) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Tab no longer exists:",
            chrome.runtime.lastError.message
          );
          // If the tab doesn't exist, let the user know
          chrome.notifications.create({
            type: "basic",
            iconUrl: "images/icon128.png",
            title: "Tab Not Found",
            message:
              "The BookMyShow tab is no longer available. You may need to restart the monitoring process.",
            priority: 1,
          });
          return;
        }

        const focusAttempts = 5; // Try 5 times
        let attemptCount = 0;

        function attemptFocus() {
          console.log(
            `Focus attempt ${attemptCount + 1}/${focusAttempts} for tab:`,
            targetTab.id
          );

          // Force the window and tab to the front
          chrome.windows.update(targetTab.windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error focusing window:",
                chrome.runtime.lastError.message
              );
              // Still try to focus the tab even if window focus fails
            }

            chrome.tabs.update(targetTab.id, { active: true }, () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Error focusing tab:",
                  chrome.runtime.lastError.message
                );
              } else {
                console.log(
                  `Tab and window focus attempt ${attemptCount + 1} completed`
                );
              }
            });
          });

          attemptCount++;
          if (attemptCount < focusAttempts) {
            // Try again after a short delay
            setTimeout(attemptFocus, 1000);
          }
        }

        // Start the focus attempts
        attemptFocus();
      });
    } else if (buttonIndex === 1) {
      // Stop Monitoring button clicked
      console.log("Stop Monitoring button clicked in notification");
      stopMonitoring();

      // Show confirmation notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "images/icon128.png",
        title: "Monitoring Stopped",
        message: "BookMyShow monitoring has been stopped successfully.",
        priority: 1,
      });
    }
  }
);

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === "stop-monitoring") {
    console.log("Stop monitoring keyboard shortcut (Alt+S) pressed");

    // Stop monitoring
    stopMonitoring();

    // Show confirmation notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "images/icon128.png",
      title: "Monitoring Stopped",
      message:
        "BookMyShow monitoring has been stopped using keyboard shortcut (Alt+S).",
      priority: 1,
    });
  }
});

// Function to show notification
function showNotification(movieName, formatInfo) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "images/icon128.png",
    title: "BookMyShow Movie Alert! 🎬",
    message: `Found "${movieName}" with ${
      formatInfo ? formatInfo : "the selected format"
    }!`,
    priority: 2,
    buttons: [{ title: "View Now" }, { title: "Stop Monitoring" }],
  });
}

// Function to start monitoring with a specific tab ID
function startMonitoringWithTab(movieName, formatPreference, interval, tabId) {
  if (!movieName) {
    console.error("No movie name provided for monitoring");
    return;
  }

  if (!interval) {
    console.error("No refresh interval provided");
    return;
  }

  if (!tabId) {
    console.error("No tab ID provided for monitoring");
    return;
  }

  // Ensure interval is a valid number
  const intervalMinutes = parseFloat(interval);
  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    console.error("Invalid refresh interval:", interval);
    return;
  }

  console.log(
    `Starting monitoring on tab ${tabId} with interval: ${intervalMinutes} minutes`
  );
  isMonitoring = true;

  // Save status to storage
  chrome.storage.local.set({
    movieName: movieName,
    formatPreference: formatPreference || "ANY",
    refreshInterval: intervalMinutes,
    isMonitoring: true,
    lastChecked: new Date().toISOString(),
  });

  console.log(
    "Starting to monitor for:",
    movieName,
    "with format:",
    formatPreference,
    "refresh interval:",
    intervalMinutes,
    "minutes"
  );

  // Get the specific tab by ID
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error("Error getting tab:", chrome.runtime.lastError.message);
      return;
    }

    if (!tab) {
      console.error("Tab with ID", tabId, "not found");
      return;
    }

    targetTab = tab;
    console.log("Using specified tab for monitoring:", tab.id, tab.url);

    // Set up alarm for periodic checking with the specified interval
    setRefreshAlarm(intervalMinutes);

    // Inject content script into the specified tab if needed
    injectContentScriptIfNeeded(tab);
  });
}
