import React, { useState } from "react";
import axios from "axios";

function Form() {
    const [form, setForm] = useState({
        electricity: "",
        water: "",
        waste: "",
        recycling: 1
    });

    const [result, setResult] = useState(null);

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const submit = async () => {
        const res = await axios.post("http://127.0.0.1:8000/predict", {
            ...form,
            recycling: parseInt(form.recycling)
        });

        setResult(res.data);
    };

    return (
        <div>
            <input name="electricity" placeholder="Electricity" onChange={handleChange} />
            <input name="water" placeholder="Water" onChange={handleChange} />
            <input name="waste" placeholder="Waste" onChange={handleChange} />

            <select name="recycling" onChange={handleChange}>
                <option value={1}>Recycling Yes</option>
                <option value={0}>Recycling No</option>
            </select>

            <br /><br />
            <button onClick={submit}>Calculate</button>

            {result && (
                <div>
                    <h2>Score: {result.score}</h2>
                    <h3>Suggestions:</h3>
                    <ul>
                        {result.suggestions.map((s, i) => (
                            <li key={i}>{s}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default Form;