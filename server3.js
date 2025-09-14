// server2.js – simplified backend with JSON file storage (no DB)
// Install first: npm i express cors axios dotenv

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---------- JSON file storage ----------
const BOOKINGS_FILE = './bookings.json';

// load existing bookings at startup
let bookings = [];
if (fs.existsSync(BOOKINGS_FILE)) {
  try {
    bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Failed to load bookings file:', err);
    bookings = [];
  }
}

let testimonials = []; // you can do same thing for testimonials if needed

// ---------- helper to save ----------
function saveBookings() {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}
// ---------------------------
// Helpers
// ---------------------------

function formatDateAndTime(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return { formattedDate: 'Invalid date', formattedTime: '' };
  }
  const pad = n => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return {
    formattedDate: `${year}-${month}-${day}`,
    formattedTime: `${pad(hours)}:${minutes} ${ampm}`
  };
}
// extract number of minutes from strings like "60min", "90 min", "120 min"
function getMinutesFromDuration(dur) {
  if (typeof dur === 'number') return dur; // already a number
  if (typeof dur === 'string') {
    const m = dur.match(/\d+/); // first number in the string
    if (m) return parseInt(m[0], 10);
  }
  return 0; // fallback
}


async function sendTelegramNotification(booking) {
  const { formattedDate, formattedTime } = formatDateAndTime(booking.datetime);

  const message = `
✅ New Booking 

Customer: ${booking.gender || 'Male/Female'}
Telegram: ${booking.phone}
Service: ${booking.service}
Duration: ${booking.duration}
Requested Therapist: ${booking.requestedTherapist || 'Male/Female'}
Price: ${booking.price}
Date: *${formattedDate}*
Arrival Time: *${formattedTime}*

Remarks:
1. Aroma Oil: ${booking.aromaOil || '"foot massage cannot choose oil"'}
2. Pressure: ${booking.pressure || 'Medium'}
3. Body area to focus: ${booking.focusArea || 'No'}
4. Body area to avoid: ${booking.avoidArea || 'No'}
`;

  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    });
    console.log('✅ Telegram booking alert sent');
  } catch (error) {
    console.error('❌ Failed to send Telegram booking alert:', error.message);
  }
}

async function sendTelegramCancelNotification(booking) {
  const { formattedDate, formattedTime } = formatDateAndTime(booking.datetime);
  const message = `
❌ *Booking Canceled*

Customer: ${booking.gender || 'N/A'}
Phone: ${booking.phone}
Service: ${booking.service}
Date: *${formattedDate}*
Time: *${formattedTime}*

⚠️ This booking has been canceled.
`;

  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    });
    console.log('✅ Telegram cancellation alert sent');
  } catch (error) {
    console.error('❌ Failed to send Telegram cancellation alert:', error.message);
  }
}


// ---------------------------
// Booking Endpoints
// ---------------------------

app.post('/booking', async (req, res) => {
  const {
  service,
  requestedTherapist,
  duration,
  price,
  gender,
  phone,
  datetime,
  aromaOil,
  pressure,
  focusArea,
  avoidArea
} = req.body;


  if (!service || !duration || !price || !gender || !phone || !datetime) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const minutes = getMinutesFromDuration(duration);
  if (minutes === 0) {
    return res.status(400).json({ error: 'Cannot determine duration in minutes from: ' + duration });
  }

  // normalize times
  const newStart = new Date(datetime).getTime();
  const newEnd = newStart + minutes * 60000;

  // check conflicts
  const isConflict = bookings.some(b => {
    const existingMinutes = getMinutesFromDuration(b.duration);
    const existingStart = new Date(b.datetime).getTime();
    const existingEnd = existingStart + existingMinutes * 60000;

    // ⚡ OPTION 1: strict overlap check (block any overlap)
    return newStart < existingEnd && newEnd > existingStart;

    // ⚡ OPTION 2: only block exact same start time
    // return newStart === existingStart;
  });

  if (isConflict) {
    console.log("⛔ Conflict detected at", new Date(newStart).toISOString());
    return res.status(409).json({ error: 'This time slot is already booked. Please select a different time.' });
  }

  // always save datetime in ISO format
 const booking = {
  id: Date.now(),
  service,
  requestedTherapist,
  duration,
  price,
  gender,
  phone,
  datetime: new Date(datetime).toISOString(),
  aromaOil,   // camelCase
  pressure,
  focusArea,  // camelCase
  avoidArea,  // camelCase
  bookedOn: new Date().toISOString()
};


  await sendTelegramNotification(booking);

  bookings.push(booking);
  saveBookings();
  res.status(201).json(booking);
});





// Get all bookings
app.get('/booking', (req, res) => {
  res.json(bookings);
});

// Delete a booking + notify Telegram
app.delete('/booking/:id', async (req, res) => {
  const { id } = req.params;
  const idx = bookings.findIndex(b => b.id === Number(id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const [removed] = bookings.splice(idx, 1);
  saveBookings(); // persist after delete

  await sendTelegramCancelNotification(removed);

  res.json({ message: `Booking with ID ${id} cancelled and Telegram notified.` });
});

// ---------------------------
// Testimonial Endpoints (same as before)
// ---------------------------
app.post('/api/testimonials', (req, res) => {
  const { reviewerName, reviewerEmail, reviewTitle, reviewText, rating, genuineOpinion } = req.body;

  if (!reviewerName || !reviewerEmail || !reviewText || !rating || genuineOpinion === undefined) {
    return res.status(400).json({ error: 'Reviewer name, email, review text, rating, and genuine opinion are required.' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }

  const testimonial = {
    id: Date.now(),
    reviewer_name: reviewerName,
    reviewer_email: reviewerEmail,
    review_title: reviewTitle && reviewTitle.trim() !== "" ? reviewTitle : "No Title",
    review_text: reviewText && reviewText.trim() !== "" ? reviewText : "N/A",
    rating,
    genuine_opinion: genuineOpinion,
    created_at: new Date().toISOString()
  };

  testimonials.push(testimonial);
  res.status(201).json(testimonial);
});

app.get('/api/testimonials', (req, res) => {
  const sorted = [...testimonials].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(sorted);
});

app.delete('/api/testimonials/:id', (req, res) => {
  const { id } = req.params;
  const idx = testimonials.findIndex(t => t.id === Number(id));

  if (idx === -1) {
    return res.status(404).json({ error: `Testimonial with ID ${id} not found.` });
  }

  testimonials.splice(idx, 1);
  res.json({ message: `✅ Testimonial with ID ${id} deleted successfully.` });
});

// ---------------------------
// Start Server
// ---------------------------
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log('Telegram alerts enabled – check your bot/chat.');
});
