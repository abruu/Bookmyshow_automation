# BookMyShow Ticket Automation

A Chrome extension to automate the process of booking movie tickets on BookMyShow. This extension monitors BookMyShow for ticket availability and automatically books tickets when they become available.

## Features

- **Movie Monitoring**: Set a movie and date to monitor for ticket availability
- **Automatic Notifications**: Get notified when tickets for your selected movie are available
- **Auto-Booking**: Optional auto-booking feature to automatically select seats
- **Customizable Preferences**: Choose your preferred seat category (VIP, Prime, Balcony, Regular)
- **Periodic Checking**: Customizable checking interval to balance resource usage and responsiveness

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the folder containing the extension files
5. The BookMyShow Automation extension should now appear in your Chrome toolbar

## Usage

1. Click on the extension icon in your Chrome toolbar
2. Enter the details for the movie you want to book:
   - Movie Name: Enter the exact movie name
   - Date: Select the date you want to watch the movie
   - Seat Preference: Choose your preferred seating category
   - Check Interval: Set how frequently the extension should check for availability (in minutes)
   - Auto-book: Toggle whether the extension should automatically book when tickets are available
3. Click "Save Preferences" to save your settings
4. Click "Start Monitoring" to begin checking for ticket availability
5. When tickets become available, you'll receive a notification

## Important Notes

- The extension works best when you provide accurate movie names exactly as they appear on BookMyShow
- The extension needs to be running in Chrome to monitor ticket availability
- Auto-booking will select the first available seat in your preferred category
- The extension will navigate to the payment page but will not complete the payment process

## Files Structure

- `manifest.json`: Extension configuration file
- `popup.html/js`: User interface for setting preferences
- `background.js`: Background script for monitoring BookMyShow
- `content.js`: Content script to interact with the BookMyShow website
- `styles.css`: Styling for the popup interface

## Limitations

- The extension depends on the BookMyShow website structure. Changes to the website may affect functionality.
- Seat selection is automatic based on category preference, not specific seat numbers.
- The extension does not handle payment processing for security reasons.

## License

This project is open source and available under the MIT License.
